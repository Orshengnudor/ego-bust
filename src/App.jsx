import { useState, useEffect, useRef } from "react";
import {
  createConfig,
  http,
  useAccount,
  useConnect,
  useDisconnect,
  usePublicClient,
  useWalletClient,
} from "wagmi";
import { metaMask } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { Implementation, toMetaMaskSmartAccount } from "@metamask/delegation-toolkit";
import { createBundlerClient } from "viem/account-abstraction";
import { parseEther, encodeFunctionData } from "viem";
import "./App.css";

// Configuration
const monadTestnet = {
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { decimals: 18, name: "Monad", symbol: "MON" },
  rpcUrls: { default: { http: ["https://monad-testnet.g.alchemy.com/v2/b5Q7A1uPLthyIDS1OsWo9"] } },
  blockExplorers: { default: { name: "Monad Testnet Explorer", url: "https://testnet.monadexplorer.com" } },
  testnet: true,
};

const config = createConfig({
  chains: [monadTestnet],
  connectors: [metaMask()],
  transports: {
    [monadTestnet.id]: http(),
  },
});

const queryClient = new QueryClient();

// Pimlico Configuration
const PIMLICO_BUNDLER_URL = import.meta.env.VITE_PIMLICO_BUNDLER_URL;
const PIMLICO_API_KEY = import.meta.env.VITE_PIMLICO_API_KEY;

console.log("✅ PIMLICO_BUNDLER_URL =", PIMLICO_BUNDLER_URL);
console.log("✅ PIMLICO_API_KEY =", PIMLICO_API_KEY ? "***" + PIMLICO_API_KEY.slice(-4) : "undefined");

// Create HTTP transport with proper headers
const pimlicoTransport = http(PIMLICO_BUNDLER_URL, {
  timeout: 60000,
  retryCount: 3,
  fetchOptions: {
    headers: {
      'Content-Type': 'application/json',
      ...(PIMLICO_API_KEY && { 'Authorization': `Bearer ${PIMLICO_API_KEY}` })
    }
  }
});

// Contract ABIs
const WMON_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "transfer", type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
];

const REWARD_ABI = [
  { name: "addScore", type: "function", stateMutability: "nonpayable", inputs: [{ name: "_score", type: "uint256" }], outputs: [] },
  { name: "claimRewards", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] },
  {
    name: "getPlayerStats",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [
      { name: "totalScore", type: "uint256" },
      { name: "totalGames", type: "uint256" },
      { name: "pendingRewards", type: "uint256" },
      { name: "totalClaimed", type: "uint256" },
      { name: "lastClaimedScore", type: "uint256" },
    ],
  },
  {
    name: "getLeaderboard",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "wallet", type: "address" },
          { name: "score", type: "uint256" },
          { name: "gamesPlayed", type: "uint256" },
          { name: "totalEarned", type: "uint256" },
        ],
      },
    ],
  },
  { name: "getPendingRewards", type: "function", stateMutability: "view", inputs: [{ name: "player", type: "address" }], outputs: [{ type: "uint256" }] },
];

const WMON_ADDRESS = import.meta.env.VITE_WMON_ADDRESS || "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701";
const REWARD_CONTRACT_ADDRESS = import.meta.env.VITE_REWARD_CONTRACT_ADDRESS || "0xa2B98D710AB9c0BC5aA4d21552B343A297C83dFF";

// Gas Configuration
const GAS_SPEED_OPTIONS = {
  standard: { name: "🐢 Standard", gwei: 9, description: "Lowest cost, slower confirmation", estimatedTime: "30-60 sec" },
  low: { name: "⚡ Low", gwei: 10, description: "Balanced speed and cost", estimatedTime: "20-40 sec" },
  high: { name: "🚀 High", gwei: 100, description: "Faster confirmation", estimatedTime: "10-20 sec" },
};

const IMAGES = Array.from({ length: 221 }, (_, i) => `/images/${i}.png`);

// Utility Functions
const gweiToWeiBigInt = (gwei) => {
  const n = Number(gwei);
  if (Number.isNaN(n)) throw new Error("Invalid gwei value");
  return BigInt(Math.round(n * 1e9));
};

const weiBigIntToGweiNumber = (weiBigInt) => Number(weiBigInt) / 1e9;

function GameApp() {
  // Game State
  const [objects, setObjects] = useState([]);
  const [score, setScore] = useState(0);
  const [time, setTime] = useState(30);
  const [gameOver, setGameOver] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [clickedObjects, setClickedObjects] = useState(new Set());

  // UI State
  const [showMenu, setShowMenu] = useState(false);
  const [activeTab, setActiveTab] = useState("game");
  const [scoreSaved, setScoreSaved] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [showGasOptions, setShowGasOptions] = useState(false);
  const [selectedGasSpeed, setSelectedGasSpeed] = useState("low");
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferAmount, setTransferAmount] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [transferType, setTransferType] = useState("MON");
  const [transferDirection, setTransferDirection] = useState("toSmart");
  const [isTransferring, setIsTransferring] = useState(false);
  const [customGasPrice, setCustomGasPrice] = useState("");
  const [showCustomGas, setShowCustomGas] = useState(false);

  // Web3 State
  const [smartAccount, setSmartAccount] = useState(null);
  const [smartAccountAddress, setSmartAccountAddress] = useState(null);
  const [bundlerClient, setBundlerClient] = useState(null);
  const [wmonBalance, setWmonBalance] = useState("0");
  const [monBalance, setMonBalance] = useState("0");
  const [mainAccountMonBalance, setMainAccountMonBalance] = useState("0");
  const [mainAccountWmonBalance, setMainAccountWmonBalance] = useState("0");
  const [pendingRewards, setPendingRewards] = useState(0);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [isSavingScore, setIsSavingScore] = useState(false);
  const [pendingTxHash, setPendingTxHash] = useState(null);

  // Auto-fill State
  const [autoFillEnabled, setAutoFillEnabled] = useState(true);
  const [isAutoFilling, setIsAutoFilling] = useState(false);

  // Data State
  const [leaderboard, setLeaderboard] = useState([]);
  const [playerStats, setPlayerStats] = useState({ totalScore: 0, totalGames: 0, pendingRewards: 0, totalClaimed: 0 });

  // Wagmi Hooks
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  // Refs & Constants
  const spawnIntervalRef = useRef(null);
  const cleanupIntervalRef = useRef(null);
  const gameAreaRef = useRef(null);
  const BASE_GAME_WIDTH = 320;
  const BASE_GAME_HEIGHT = 384;
  const IMAGE_SIZE = 35;
  const BORDER_WIDTH = 3;

  const getCurrentGasOptions = () => {
    if (showCustomGas && customGasPrice) {
      const customGwei = Number(customGasPrice);
      if (!Number.isNaN(customGwei) && customGwei > 0) {
        return {
          name: `🎛️ Custom (${customGwei} gwei)`,
          gwei: customGwei,
          description: "Custom gas price",
          estimatedTime: "Varies",
        };
      }
    }
    return GAS_SPEED_OPTIONS[selectedGasSpeed] || GAS_SPEED_OPTIONS.low;
  };

  const calculateRequiredGasMON = (gasOptions, estimatedGas = 200000) => {
    const buffer = 1.2;
    const gwei = Number(gasOptions.gwei);
    const weiPerUnit = gwei * 1e9;
    const totalWei = weiPerUnit * estimatedGas * buffer;
    return totalWei / 1e18;
  };

  // Bundler Client Initialization
  useEffect(() => {
    const createBundler = async () => {
      try {
        const bundler = createBundlerClient({
          transport: pimlicoTransport,
        });
        setBundlerClient(bundler);
        console.log("✅ Bundler client initialized with Pimlico");
      } catch (err) {
        console.error("Failed to create bundler client:", err);
      }
    };

    createBundler();
  }, []);

  // Gas Price Fetching
  const fetchPimlicoGasPrice = async () => {
    if (!bundlerClient) throw new Error("Bundler client not initialized");
    
    try {
      const res = await bundlerClient.request({ method: "pimlico_getUserOperationGasPrice", params: [] });
      const uop = res?.userOperationGasPrice || res;
      const best = uop?.fast || uop?.standard || uop;
      
      const maxFeePerGasWei = typeof best?.maxFeePerGas === "string" ? BigInt(best.maxFeePerGas) : best?.maxFeePerGas ? BigInt(best.maxFeePerGas) : null;
      const maxPriorityFeePerGasWei = typeof best?.maxPriorityFeePerGas === "string" ? BigInt(best.maxPriorityFeePerGas) : best?.maxPriorityFeePerGas ? BigInt(best.maxPriorityFeePerGas) : null;

      if (maxFeePerGasWei && maxPriorityFeePerGasWei) {
        return {
          maxFeePerGasWei,
          maxPriorityFeePerGasWei,
          asGwei: { maxFeePerGasGwei: Number(maxFeePerGasWei) / 1e9, maxPriorityFeePerGasGwei: Number(maxPriorityFeePerGasWei) / 1e9 },
        };
      }
      return null;
    } catch (err) {
      console.warn("Failed to fetch pimlico gas price:", err);
      return null;
    }
  };

  // Smart Account Initialization
  useEffect(() => {
    let cancelled = false;

    const initializeSmartAccount = async () => {
      if (!isConnected || !address || !publicClient || !walletClient || !bundlerClient) {
        console.log("❌ Missing dependencies for smart account:", {
          isConnected,
          address,
          publicClient: !!publicClient,
          walletClient: !!walletClient,
          bundlerClient: !!bundlerClient
        });
        return;
      }
      
      try {
        console.log("🔄 Starting smart account initialization...");
        
        const smartAcc = await toMetaMaskSmartAccount({
          client: publicClient,
          implementation: Implementation.Hybrid,
          deployParams: [address, [], [], []],
          deploySalt: "0x",
          signer: { walletClient },
        });

        if (cancelled) {
          console.log("❌ Smart account initialization cancelled");
          return;
        }

        console.log("✅ Smart Account created:", smartAcc.address);
        setSmartAccount(smartAcc);
        setSmartAccountAddress(smartAcc.address);

        // Load balances immediately
        console.log("🔄 Loading balances after smart account creation...");
        await loadAllBalances(address, smartAcc.address);
        
        // Load player stats and leaderboard
        await loadPlayerStats(smartAcc.address);
        await loadLeaderboardData();

        console.log("🎉 Smart Account fully initialized");
      } catch (error) {
        console.error("❌ Smart account initialization error:", error);
      }
    };

    // Only initialize if we have all required dependencies
    if (isConnected && address && publicClient && walletClient && bundlerClient) {
      console.log("🚀 All dependencies ready, initializing smart account...");
      initializeSmartAccount();
    } else {
      console.log("⏳ Waiting for dependencies:", {
        isConnected,
        address,
        publicClient: !!publicClient,
        walletClient: !!walletClient,
        bundlerClient: !!bundlerClient
      });
    }

    return () => {
      cancelled = true;
    };
  }, [isConnected, address, publicClient, walletClient, bundlerClient]);

  // Load balances when wallet connects (even before smart account)
  useEffect(() => {
    if (isConnected && address && publicClient) {
      console.log("🔄 Loading main wallet balances on connection...");
      loadAllBalances(address, null);
    }
  }, [isConnected, address, publicClient]);

  // Image Preloading
  useEffect(() => {
    IMAGES.forEach((src) => {
      const img = new Image();
      img.src = src;
    });
  }, []);

  // UI Helpers
  const copyAddress = async () => {
    const addressToCopy = smartAccountAddress || address;
    if (!addressToCopy) return;
    try {
      await navigator.clipboard.writeText(addressToCopy);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    } catch (err) {
      console.error("Failed to copy address:", err);
    }
  };

  const formatAddress = (addr) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";
  const formatFullAddress = (addr) => addr || "";

  // Data Loading
  const loadAllBalances = async (mainAddress, smartAddress) => {
    if (!publicClient) {
      console.log("❌ Public client not available for loading balances");
      return;
    }
    
    try {
      console.log("💰 Loading balances for:", { mainAddress, smartAddress });
      
      // Load main wallet balances
      if (mainAddress) {
        try {
          console.log("📥 Loading main MON balance...");
          const mainMonBalanceWei = await publicClient.getBalance({ 
            address: mainAddress 
          });
          const mainMonBalance = (Number(mainMonBalanceWei) / 1e18).toFixed(6);
          setMainAccountMonBalance(mainMonBalance);
          console.log("✅ Main MON balance:", mainMonBalance);
        } catch (err) {
          console.error("❌ Error loading main MON balance:", err);
          setMainAccountMonBalance("0");
        }
        
        // Load main WMON balance
        if (WMON_ADDRESS) {
          try {
            console.log("📥 Loading main WMON balance...");
            const mainWmonBalanceWei = await publicClient.readContract({
              address: WMON_ADDRESS,
              abi: WMON_ABI,
              functionName: "balanceOf",
              args: [mainAddress],
            });
            const mainWmonBalance = (Number(mainWmonBalanceWei) / 1e18).toFixed(4);
            setMainAccountWmonBalance(mainWmonBalance);
            console.log("✅ Main WMON balance:", mainWmonBalance);
          } catch (err) {
            console.error("❌ Error loading main WMON balance:", err);
            setMainAccountWmonBalance("0");
          }
        }
      }

      // Load smart account balances
      if (smartAddress) {
        try {
          console.log("📥 Loading smart account MON balance...");
          const smartMonBalanceWei = await publicClient.getBalance({ 
            address: smartAddress 
          });
          const smartMonBalance = (Number(smartMonBalanceWei) / 1e18).toFixed(6);
          setMonBalance(smartMonBalance);
          console.log("✅ Smart MON balance:", smartMonBalance);
        } catch (err) {
          console.error("❌ Error loading smart MON balance:", err);
          setMonBalance("0");
        }

        // Load smart WMON balance
        if (WMON_ADDRESS) {
          try {
            console.log("📥 Loading smart account WMON balance...");
            const smartWmonBalanceWei = await publicClient.readContract({
              address: WMON_ADDRESS,
              abi: WMON_ABI,
              functionName: "balanceOf",
              args: [smartAddress],
            });
            const smartWmonBalance = (Number(smartWmonBalanceWei) / 1e18).toFixed(4);
            setWmonBalance(smartWmonBalance);
            console.log("✅ Smart WMON balance:", smartWmonBalance);
          } catch (err) {
            console.error("❌ Error loading smart WMON balance:", err);
            setWmonBalance("0");
          }
        }
      }
      
      console.log("💰 All balances loaded successfully");
    } catch (err) {
      console.error("❌ Error loading balances:", err);
    }
  };

  const loadPlayerStats = async (userAddress) => {
    if (!publicClient || !REWARD_CONTRACT_ADDRESS) return;
    
    try {
      const stats = await publicClient.readContract({
        address: REWARD_CONTRACT_ADDRESS,
        abi: REWARD_ABI,
        functionName: "getPlayerStats",
        args: [userAddress],
      });
      
      setPlayerStats({
        totalScore: Number(stats[0]),
        totalGames: Number(stats[1]),
        pendingRewards: Number(stats[2]) / 1e18,
        totalClaimed: Number(stats[3]) / 1e18,
      });
      setPendingRewards(Number(stats[2]) / 1e18);
    } catch (err) {
      console.error("Error loading player stats:", err);
    }
  };

  const loadLeaderboardData = async () => {
    if (!publicClient || !REWARD_CONTRACT_ADDRESS) return;
    
    try {
      const data = await publicClient.readContract({
        address: REWARD_CONTRACT_ADDRESS,
        abi: REWARD_ABI,
        functionName: "getLeaderboard",
      });
      
      const formatted = data.map((entry) => ({
        wallet: entry.wallet,
        score: Number(entry.score),
        gamesPlayed: Number(entry.gamesPlayed),
        totalEarned: Number(entry.totalEarned) / 1e18,
      }));
      
      formatted.sort((a, b) => b.score - a.score);
      setLeaderboard(formatted);
    } catch (err) {
      console.error("Error loading leaderboard:", err);
    }
  };

  // Auto-fill Gas
  const autoFillGasIfNeeded = async (requiredGasMON, operationType = "transaction") => {
    if (!autoFillEnabled || !smartAccountAddress || !address || !walletClient) return false;

    const currentBalance = Number(monBalance);
    if (currentBalance >= requiredGasMON) return true;

    try {
      setIsAutoFilling(true);
      console.log(`🔄 Auto-filling ${requiredGasMON.toFixed(6)} MON for ${operationType}...`);

      const transferAmountMON = Number((requiredGasMON * 1.1).toFixed(6));
      if (Number(mainAccountMonBalance) < transferAmountMON) {
        console.log("❌ Main wallet doesn't have enough MON for auto-fill");
        return false;
      }

      const txHash = await walletClient.sendTransaction({
        to: smartAccountAddress,
        value: parseEther(String(transferAmountMON)),
      });

      console.log("Auto fill tx submitted:", txHash);
      setPendingTxHash(txHash);

      await new Promise((r) => setTimeout(r, 4000));
      await loadAllBalances(address, smartAccountAddress);

      console.log("✅ Auto fill completed");
      return true;
    } catch (err) {
      console.error("❌ Auto fill failed:", err);
      return false;
    } finally {
      setIsAutoFilling(false);
    }
  };

  // Wallet Management
  const connectWallet = async () => {
    try {
      setIsConnecting(true);
      
      // Check if any Ethereum provider is available
      if (typeof window.ethereum === 'undefined') {
        alert("No Ethereum wallet found. Please install a Web3 wallet like MetaMask, Trust Wallet, or Coinbase Wallet.");
        setIsConnecting(false);
        return;
      }
      
      // Connect with any available wallet
      await connect({ connector: metaMask() });
    } catch (err) {
      console.error("Connection error:", err);
      alert("Failed to connect wallet. Please make sure your wallet is unlocked and try again.");
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectWallet = () => {
    disconnect();
    setSmartAccount(null);
    setSmartAccountAddress(null);
    setWmonBalance("0");
    setMonBalance("0");
    setMainAccountMonBalance("0");
    setMainAccountWmonBalance("0");
    setPendingRewards(0);
    setPlayerStats({ totalScore: 0, totalGames: 0, pendingRewards: 0, totalClaimed: 0 });
    setScoreSaved(false);
    setCopiedAddress(false);
    setPendingTxHash(null);
    setAutoFillEnabled(true);
    setIsAutoFilling(false);
  };

  // Transfer Functions
  const transferFunds = async () => {
    if (!transferAmount || !transferTo || !transferType || !transferDirection) {
      alert("Invalid transfer details");
      return;
    }

    try {
      setIsTransferring(true);

      const amount = Number(transferAmount);
      if (Number.isNaN(amount) || amount <= 0) {
        alert("Please enter a valid amount");
        return;
      }

      if (!transferTo.match(/^0x[a-fA-F0-9]{40}$/)) {
        alert("Please enter a valid Ethereum address");
        return;
      }

      const gasPreset = getCurrentGasOptions();

      if (transferDirection === "toSmart") {
        if (!walletClient) throw new Error("Wallet client not available");

        if (transferType === "MON") {
          if (amount > Number(mainAccountMonBalance)) {
            alert(`Insufficient MON. Available: ${mainAccountMonBalance}`);
            return;
          }
          const txHash = await walletClient.sendTransaction({
            to: transferTo,
            value: parseEther(String(amount)),
          });
          setPendingTxHash(txHash);
          alert(`✅ Sent ${amount} MON`);
        } else {
          if (amount > Number(mainAccountWmonBalance)) {
            alert(`Insufficient WMON. Available: ${mainAccountWmonBalance}`);
            return;
          }
          const data = encodeFunctionData({
            abi: WMON_ABI,
            functionName: "transfer",
            args: [transferTo, parseEther(String(amount))],
          });
          const txHash = await walletClient.sendTransaction({
            to: WMON_ADDRESS,
            data,
          });
          setPendingTxHash(txHash);
          alert(`✅ Sent ${amount} WMON`);
        }
      } else {
        if (!bundlerClient || !smartAccount) {
          alert("Smart Account service not available. Please try again.");
          return;
        }

        const pimlicoGas = await fetchPimlicoGasPrice();
        let maxFeePerGasWei = pimlicoGas?.maxFeePerGasWei ?? gweiToWeiBigInt(gasPreset.gwei);
        let maxPriorityFeePerGasWei = pimlicoGas?.maxPriorityFeePerGasWei ?? gweiToWeiBigInt(Math.max(1, Math.floor(gasPreset.gwei * 0.1)));

        const estimatedGas = 200000;
        const requiredGasMON = calculateRequiredGasMON({ gwei: Number(weiBigIntToGweiNumber(maxFeePerGasWei)) }, estimatedGas);
        
        if (Number(monBalance) < requiredGasMON) {
          if (autoFillEnabled) {
            const ok = await autoFillGasIfNeeded(requiredGasMON, "fund transfer");
            if (!ok) {
              alert(`Smart Account needs MON for gas. Current: ${monBalance} MON, Required: ~${requiredGasMON.toFixed(6)} MON`);
              return;
            }
          } else {
            alert(`Smart Account needs MON for gas. Current: ${monBalance} MON, Required: ~${requiredGasMON.toFixed(6)} MON`);
            return;
          }
        }

        if (transferType === "MON") {
          if (amount > Number(monBalance)) {
            alert(`Insufficient MON balance. Available: ${monBalance}`);
            return;
          }

          console.log(`🔄 Sending MON via Smart Account with Pimlico`);

          const userOpHash = await bundlerClient.sendUserOperation({
            account: smartAccount,
            calls: [
              {
                to: transferTo,
                value: parseEther(String(amount)),
                data: "0x",
              },
            ],
            maxFeePerGas: maxFeePerGasWei,
            maxPriorityFeePerGas: maxPriorityFeePerGasWei,
          });

          setPendingTxHash(userOpHash);
          const { receipt } = await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash, timeout: 120000 });
          console.log("Transaction confirmed:", receipt.transactionHash);
          alert(`✅ Successfully transferred ${amount} MON`);
        } else {
          if (amount > Number(wmonBalance)) {
            alert(`Insufficient WMON balance. Available: ${wmonBalance}`);
            return;
          }

          console.log(`🔄 Sending WMON via Smart Account with Pimlico`);

          const txData = encodeFunctionData({
            abi: WMON_ABI,
            functionName: "transfer",
            args: [transferTo, parseEther(String(amount))],
          });

          const userOpHash = await bundlerClient.sendUserOperation({
            account: smartAccount,
            calls: [
              {
                to: WMON_ADDRESS,
                data: txData,
              },
            ],
            maxFeePerGas: maxFeePerGasWei,
            maxPriorityFeePerGas: maxPriorityFeePerGasWei,
          });

          setPendingTxHash(userOpHash);
          const { receipt } = await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash, timeout: 120000 });
          console.log("Transaction confirmed:", receipt.transactionHash);
          alert(`✅ Successfully transferred ${amount} WMON`);
        }
      }

      setTransferAmount("");
      setTransferTo("");
      setShowTransferModal(false);
      setTimeout(() => loadAllBalances(address, smartAccountAddress), 3000);
    } catch (err) {
      console.error("Transfer error:", err);
      const msg = (err?.message || "").toLowerCase();
      if (msg.includes("timeout")) {
        alert("Transaction is taking longer than expected; check explorer later.");
      } else if (msg.includes("insufficient funds")) {
        if (autoFillEnabled && !isAutoFilling) {
          const gasPreset = getCurrentGasOptions();
          const requiredGasMON = calculateRequiredGasMON(gasPreset, 200000);
          const ok = await autoFillGasIfNeeded(requiredGasMON, "retry transfer");
          if (ok) {
            setTimeout(transferFunds, 2000);
            return;
          }
        }
        alert("Smart Account doesn't have enough MON for gas. Please fund it first.");
      } else {
        alert(`Transfer failed: ${err?.message ?? JSON.stringify(err)}`);
      }
    } finally {
      setIsTransferring(false);
    }
  };

  // Quick Transfer Helpers
  const quickTransferToSmart = async (type) => {
    if (!smartAccountAddress && !address) {
      alert("No smart account address found");
      return;
    }
    setTransferDirection("toSmart");
    setTransferType(type);
    setTransferTo(smartAccountAddress);
    if (type === "MON") {
      const available = Math.max(0, Number(mainAccountMonBalance) - 0.01);
      setTransferAmount(available > 0 ? available.toFixed(6) : mainAccountMonBalance);
    } else {
      setTransferAmount(mainAccountWmonBalance);
    }
    setShowTransferModal(true);
  };

  const quickTransferToMain = async (type) => {
    if (!address) {
      alert("No main wallet address found");
      return;
    }
    setTransferDirection("toMain");
    setTransferType(type);
    setTransferTo(address);
    if (type === "MON") {
      const available = Math.max(0, Number(monBalance) - 0.01);
      setTransferAmount(available > 0 ? available.toFixed(6) : monBalance);
    } else {
      setTransferAmount(wmonBalance);
    }
    setShowTransferModal(true);
  };

  // Game Actions
  const saveScoreAndAccumulate = async () => {
    if (!smartAccount || scoreSaved) return;
    
    try {
      setIsSavingScore(true);
      console.log("🔄 Saving score via Smart Account with Pimlico...");

      if (!bundlerClient) {
        alert("Smart Account service not available. Please try again.");
        return;
      }

      const gasPreset = getCurrentGasOptions();
      const pimlicoGas = await fetchPimlicoGasPrice();
      const maxFeePerGasWei = pimlicoGas?.maxFeePerGasWei ?? gweiToWeiBigInt(gasPreset.gwei);
      const maxPriorityFeePerGasWei = pimlicoGas?.maxPriorityFeePerGasWei ?? gweiToWeiBigInt(Math.max(1, Math.floor(gasPreset.gwei * 0.1)));

      const requiredGasMON = calculateRequiredGasMON({ gwei: Number(weiBigIntToGweiNumber(maxFeePerGasWei)) }, 250000);
      
      if (Number(monBalance) < requiredGasMON) {
        if (autoFillEnabled) {
          const autoFillSuccess = await autoFillGasIfNeeded(requiredGasMON, "score saving");
          if (!autoFillSuccess) {
            alert(`Your Smart Account needs MON for gas!
Current: ${monBalance} MON
Required: ~${requiredGasMON.toFixed(6)} MON
Please send MON to: ${smartAccountAddress}`);
            return;
          }
        } else {
          alert(`Your Smart Account needs MON for gas!
Current: ${monBalance} MON
Required: ~${requiredGasMON.toFixed(6)} MON
Please send MON to: ${smartAccountAddress}`);
          return;
        }
      }

      console.log(`💾 Saving score with Pimlico`);

      const userOpHash = await bundlerClient.sendUserOperation({
        account: smartAccount,
        calls: [
          {
            to: REWARD_CONTRACT_ADDRESS,
            data: encodeFunctionData({
              abi: REWARD_ABI,
              functionName: "addScore",
              args: [score],
            }),
          },
        ],
        maxFeePerGas: maxFeePerGasWei,
        maxPriorityFeePerGas: maxPriorityFeePerGasWei,
      });

      console.log("Score save user operation hash:", userOpHash);
      setPendingTxHash(userOpHash);

      const { receipt } = await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash, timeout: 120000 });
      console.log("🎉 Transaction confirmed:", receipt.transactionHash);

      setScoreSaved(true);
      setPendingTxHash(null);

      await loadAllBalances(address, smartAccountAddress);
      await loadPlayerStats(smartAccountAddress);
      await loadLeaderboardData();

      alert("🎉 Score saved successfully with Pimlico!");
    } catch (error) {
      console.error("Save score error:", error);
      const msg = (error?.message || "").toLowerCase();
      if (msg.includes("insufficient funds")) {
        if (autoFillEnabled && !isAutoFilling) {
          const gasPreset = getCurrentGasOptions();
          const requiredGasMON = calculateRequiredGasMON(gasPreset, 250000);
          const ok = await autoFillGasIfNeeded(requiredGasMON, "retry score saving");
          if (ok) {
            setTimeout(saveScoreAndAccumulate, 2000);
            return;
          }
        }
        alert("Your Smart Account needs MON for gas. Please fund it first.");
      } else if (msg.includes("paymaster")) {
        alert("Pimlico paymaster service temporarily unavailable. Please try again later.");
      } else if (msg.includes("timeout")) {
        alert("Transaction is taking longer than expected. It may still be processing.");
      } else {
        alert("Failed to save score. Please try again.");
      }
    } finally {
      setIsSavingScore(false);
    }
  };

  const claimRewards = async () => {
    if (!smartAccount) return;
    if (pendingRewards < 1) {
      alert(`You need at least 1 WMON to claim! Current: ${pendingRewards.toFixed(2)} WMON`);
      return;
    }

    try {
      setIsClaiming(true);
      if (!bundlerClient) {
        alert("Smart Account service not available. Cannot claim rewards.");
        return;
      }

      const pimlicoGas = await fetchPimlicoGasPrice();
      const gasPreset = getCurrentGasOptions();
      const maxFeePerGasWei = pimlicoGas?.maxFeePerGasWei ?? gweiToWeiBigInt(gasPreset.gwei);
      const maxPriorityFeePerGasWei = pimlicoGas?.maxPriorityFeePerGasWei ?? gweiToWeiBigInt(Math.max(1, Math.floor(gasPreset.gwei * 0.1)));

      const requiredGasMON = calculateRequiredGasMON({ gwei: Number(weiBigIntToGweiNumber(maxFeePerGasWei)) }, 250000);
      
      if (Number(monBalance) < requiredGasMON) {
        if (autoFillEnabled) {
          const autoFillSuccess = await autoFillGasIfNeeded(requiredGasMON, "reward claiming");
          if (!autoFillSuccess) {
            alert(`Your Smart Account needs MON for gas! Current: ${monBalance} MON, Required: ~${requiredGasMON.toFixed(6)} MON`);
            return;
          }
        } else {
          alert(`Your Smart Account needs MON for gas! Current: ${monBalance} MON, Required: ~${requiredGasMON.toFixed(6)} MON`);
          return;
        }
      }

      console.log("🎁 Claiming rewards with Pimlico");

      const userOpHash = await bundlerClient.sendUserOperation({
        account: smartAccount,
        calls: [
          {
            to: REWARD_CONTRACT_ADDRESS,
            data: encodeFunctionData({ abi: REWARD_ABI, functionName: "claimRewards", args: [] }),
          },
        ],
        maxFeePerGas: maxFeePerGasWei,
        maxPriorityFeePerGas: maxPriorityFeePerGasWei,
      });

      const { receipt } = await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash, timeout: 120000 });
      alert(`🎉 Successfully claimed ${pendingRewards.toFixed(2)} WMON using Pimlico!`);

      await loadAllBalances(address, smartAccountAddress);
      await loadPlayerStats(smartAccountAddress);
      await loadLeaderboardData();
    } catch (error) {
      console.error("Error claiming rewards:", error);
      const msg = (error?.message || "").toLowerCase();
      if (msg.includes("insufficient funds")) {
        if (autoFillEnabled && !isAutoFilling) {
          const gasPreset = getCurrentGasOptions();
          const requiredGasMON = calculateRequiredGasMON(gasPreset, 250000);
          const ok = await autoFillGasIfNeeded(requiredGasMON, "retry reward claiming");
          if (ok) {
            setTimeout(claimRewards, 2000);
            return;
          }
        }
        alert("Your Smart Account needs MON for gas. Please fund it first.");
      } else if (msg.includes("paymaster")) {
        alert("Pimlico paymaster service temporarily unavailable. Please try again later.");
      } else {
        alert("Failed to claim rewards. Please try again.");
      }
    } finally {
      setIsClaiming(false);
    }
  };

  // Game Logic
  useEffect(() => {
    if (!gameStarted || gameOver || paused) {
      if (spawnIntervalRef.current) {
        clearInterval(spawnIntervalRef.current);
        spawnIntervalRef.current = null;
      }
      return;
    }

    const spawnObject = () => {
      const gameArea = gameAreaRef.current;
      const width = gameArea ? gameArea.offsetWidth : BASE_GAME_WIDTH;
      const height = gameArea ? gameArea.offsetHeight : BASE_GAME_HEIGHT;
      
      if (width > 0 && height > 0) {
        const newObj = {
          id: Date.now() + Math.random(),
          x: Math.floor(Math.random() * Math.max(1, width - IMAGE_SIZE - 2 * BORDER_WIDTH)),
          y: Math.floor(Math.random() * Math.max(1, height - IMAGE_SIZE - 2 * BORDER_WIDTH)),
          image: IMAGES[Math.floor(Math.random() * IMAGES.length)],
          spawnTime: Date.now(),
        };
        setObjects((prev) => (prev.length >= 30 ? [...prev.slice(1), newObj] : [...prev, newObj]));
      }
    };

    spawnObject();
    spawnIntervalRef.current = setInterval(spawnObject, 200);

    return () => {
      if (spawnIntervalRef.current) clearInterval(spawnIntervalRef.current);
    };
  }, [gameStarted, gameOver, paused]);

  useEffect(() => {
    if (!gameStarted || gameOver || paused) {
      if (cleanupIntervalRef.current) {
        clearInterval(cleanupIntervalRef.current);
        cleanupIntervalRef.current = null;
      }
      return;
    }

    cleanupIntervalRef.current = setInterval(() => {
      const currentTime = Date.now();
      setObjects((prev) => prev.filter((obj) => currentTime - obj.spawnTime < 1000));
    }, 100);

    return () => {
      if (cleanupIntervalRef.current) clearInterval(cleanupIntervalRef.current);
    };
  }, [gameStarted, gameOver, paused]);

  useEffect(() => {
    if (!gameStarted || gameOver || paused) return;
    if (time > 0) {
      const timer = setTimeout(() => setTime((t) => t - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      setGameOver(true);
      setObjects([]);
    }
  }, [time, gameStarted, gameOver, paused]);

  // Game Controls
  const startGame = () => {
    if (!isConnected) {
      alert("Please connect your wallet first!");
      return;
    }
    setGameStarted(true);
    setGameOver(false);
    setPaused(false);
    setScore(0);
    setTime(30);
    setObjects([]);
    setClickedObjects(new Set());
    setScoreSaved(false);
  };

  const quitGame = () => {
    setGameStarted(false);
    setGameOver(false);
    setPaused(false);
    setObjects([]);
    setClickedObjects(new Set());
    setScoreSaved(false);
  };

  const togglePause = () => setPaused((p) => !p);

  const bustObject = (id) => {
    if (paused) return;
    setClickedObjects((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setObjects((prev) => prev.filter((obj) => obj.id !== id));
      setClickedObjects((prev) => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
      setScore((s) => s + 10);
    }, 300);
  };

  // Modal Components
  const renderTransferModal = () => {
    if (!showTransferModal) return null;
    
    const directionLabel = transferDirection === "toSmart" ? "to Smart Account ⚡" : "to Main Wallet";
    const sourceBalance = transferDirection === "toSmart" 
      ? (transferType === "MON" ? mainAccountMonBalance : mainAccountWmonBalance)
      : (transferType === "MON" ? monBalance : wmonBalance);

    return (
      <div className="modal-overlay" onClick={(e) => e.stopPropagation()}>
        <div className="transfer-modal">
          <h3>💸 Transfer Funds</h3>
          <p className="transfer-direction">Transferring {directionLabel}</p>

          <div className="transfer-form">
            <div className="form-group">
              <label>Transfer Direction</label>
              <select value={transferDirection} onChange={(e) => setTransferDirection(e.target.value)} className="direction-select">
                <option value="toSmart">Main Wallet → Smart Account</option>
                <option value="toMain">Smart Account → Main Wallet</option>
              </select>
            </div>

            <div className="form-group">
              <label>Token Type</label>
              <select value={transferType} onChange={(e) => setTransferType(e.target.value)} className="token-select">
                <option value="MON">MON (Gas Token)</option>
                <option value="WMON">WMON (Reward Token)</option>
              </select>
            </div>

            <div className="form-group">
              <label>Amount</label>
              <input type="number" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} placeholder={`Enter ${transferType} amount`} className="amount-input" step="0.000001" />
              <div className="balance-info">Available: {sourceBalance} {transferType}</div>
            </div>

            <div className="form-group">
              <label>{transferDirection === "toSmart" ? "To Smart Account" : "To Main Wallet"}</label>
              <input type="text" value={transferTo} onChange={(e) => setTransferTo(e.target.value)} placeholder="0x..." className="address-input" readOnly={transferDirection === "toSmart" || transferDirection === "toMain"} />
              <div className="quick-transfer-note">{transferDirection === "toSmart" ? "💡 Funding your Smart Account" : "💡 Withdrawing to your Main Wallet"}</div>
            </div>
          </div>

          <div className="modal-actions">
            <button onClick={transferFunds} disabled={isTransferring || !transferAmount || !transferTo} className="transfer-btn">
              {isTransferring ? "⏳ Transferring..." : `💸 Transfer ${transferType}`}
            </button>
            <button onClick={() => setShowTransferModal(false)} className="cancel-btn">
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderGasSpeedSelector = () => {
    if (!showGasOptions) return null;
    const currentGasOptions = getCurrentGasOptions();

    return (
      <div className="gas-options-overlay" onClick={(e) => e.stopPropagation()}>
        <div className="gas-options-modal">
          <h3>⚡ Select Gas Speed</h3>
          <p className="gas-options-description">Choose transaction speed and cost</p>

          <div className="custom-gas-section">
            <div className="form-group">
              <label>🎛️ Custom Gas Price (gwei)</label>
              <input type="number" value={customGasPrice} onChange={(e) => setCustomGasPrice(e.target.value)} placeholder="Enter custom gwei (e.g., 15)" className="custom-gas-input" min="1" max="1000" />
              <div className="custom-gas-actions">
                <button onClick={() => setShowCustomGas(!showCustomGas)} className={`custom-gas-toggle ${showCustomGas ? "active" : ""}`}>
                  {showCustomGas ? "✅ Using Custom" : "🎛️ Use Custom"}
                </button>
                {showCustomGas && customGasPrice && <span className="custom-gas-preview">Custom: {customGasPrice} gwei</span>}
              </div>
            </div>
          </div>

          <div className="gas-presets-section">
            <h4>Preset Options:</h4>
            <div className="gas-options-list">
              {Object.entries(GAS_SPEED_OPTIONS).map(([key, option]) => (
                <div
                  key={key}
                  className={`gas-option ${selectedGasSpeed === key && !showCustomGas ? "selected" : ""}`}
                  onClick={() => {
                    setSelectedGasSpeed(key);
                    setShowCustomGas(false);
                    setShowGasOptions(false);
                  }}
                >
                  <div className="gas-option-header">
                    <span className="gas-option-name">{option.name}</span>
                    <span className="gas-option-time">{option.estimatedTime}</span>
                  </div>
                  <div className="gas-option-details">
                    <span className="gas-price">{option.gwei} gwei</span>
                    <span className="gas-description">{option.description}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="current-gas-selection">
            <h4>Current Selection:</h4>
            <div className="current-gas-info">
              <span className="gas-name">{currentGasOptions.name}</span>
              <span className="gas-price">({currentGasOptions.gwei} gwei)</span>
            </div>
          </div>

          <button className="close-gas-options" onClick={() => setShowGasOptions(false)}>
            Apply Selection
          </button>
        </div>
      </div>
    );
  };

  // Content Renderer
  const renderContent = () => {
    const currentGasOptions = getCurrentGasOptions();

    switch (activeTab) {
      case "leaderboard":
        return (
          <div className="w-full max-w-4xl mx-auto">
            <h2 className="text-3xl font-bold mb-6 text-center">🏆 Leaderboard</h2>
            <div className="bg-purple-800 rounded-xl p-6 shadow-2xl">
              {leaderboard.length === 0 ? (
                <p className="text-center text-lg opacity-80">No scores yet. Be the first!</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-white">
                    <thead>
                      <tr className="border-b-2 border-purple-600">
                        <th className="text-left py-4 px-4 font-bold text-lg">Rank</th>
                        <th className="text-left py-4 px-4 font-bold text-lg">Player</th>
                        <th className="text-right py-4 px-4 font-bold text-lg">Score</th>
                        <th className="text-right py-4 px-4 font-bold text-lg">Games</th>
                        <th className="text-right py-4 px-4 font-bold text-lg">Reward</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboard.map((entry, idx) => (
                        <tr
                          key={idx}
                          className={`border-b border-purple-700 hover:bg-purple-700 transition-colors ${entry.wallet.toLowerCase() === smartAccountAddress?.toLowerCase() ? "bg-purple-600" : ""}`}
                        >
                          <td className="py-3 px-4 font-semibold">#{idx + 1}</td>
                          <td className="py-3 px-4 font-mono">
                            {formatAddress(entry.wallet)}
                            {entry.wallet.toLowerCase() === smartAccountAddress?.toLowerCase() && <span className="ml-2 text-yellow-400">⭐</span>}
                          </td>
                          <td className="py-3 px-4 text-right font-bold">{entry.score.toLocaleString()}</td>
                          <td className="py-3 px-4 text-right">{entry.gamesPlayed}</td>
                          <td className="py-3 px-4 text-right font-bold text-green-400">{entry.totalEarned.toFixed(2)} WMON</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        );

      case "stats":
        return (
          <div className="w-full max-w-2xl mx-auto">
            <h2 className="text-3xl font-bold mb-6 text-center">📊 My Stats</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="stats-card bg-purple-800">
                <h3>Total Games</h3>
                <p className="text-3xl font-bold">{playerStats.totalGames}</p>
              </div>
              <div className="stats-card bg-green-800">
                <h3>Total Score</h3>
                <p className="text-3xl font-bold">{playerStats.totalScore.toLocaleString()}</p>
              </div>
              <div className="stats-card bg-yellow-600">
                <h3>Pending Rewards</h3>
                <p className="text-3xl font-bold">{pendingRewards.toFixed(2)} WMON</p>
              </div>
              <div className="stats-card bg-blue-600">
                <h3>Total Claimed</h3>
                <p className="text-3xl font-bold">{playerStats.totalClaimed.toFixed(2)} WMON</p>
              </div>
            </div>

            {pendingRewards >= 1 && (
              <div className="mt-8 text-center">
                <div className="mb-4">
                  <button
                    className="gas-speed-selector"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowGasOptions(!showGasOptions);
                    }}
                  >
                    ⚡ Gas: {currentGasOptions.name}
                    {autoFillEnabled && <span className="auto-fill-indicator">🤖</span>}
                  </button>
                </div>
                <button onClick={claimRewards} disabled={isClaiming} className="claim-btn text-xl">
                  {isClaiming ? "⏳ Claiming..." : `🎁 Claim ${pendingRewards.toFixed(2)} WMON`}
                </button>
              </div>
            )}
          </div>
        );

      default:
        return (
          <div className="game-container">
            <div className="game-stats mb-4">
              <div className="stat">
                <span className="stat-label">Time</span>
                <span className="stat-value">{time}s</span>
              </div>
              <div className="stat">
                <span className="stat-label">Score</span>
                <span className="stat-value">{score}</span>
              </div>
              <div className="stat">
                <span className="stat-label">WMON</span>
                <span className="stat-value">{(score * 0.01).toFixed(2)}</span>
              </div>
            </div>

            <div className={`relative overflow-hidden rounded-xl game-area ${paused ? "paused" : ""} ${!isConnected ? "opacity-50" : ""}`} ref={gameAreaRef}>
              {!isConnected && (
                <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-70 z-10">
                  <p className="text-white text-lg font-semibold">Connect Wallet to Play</p>
                </div>
              )}

              {objects.map((obj) => (
                <img key={obj.id} src={obj.image} alt="object" className={`game-object ${clickedObjects.has(obj.id) ? "pop-effect" : ""}`} style={{ left: `${obj.x}px`, top: `${obj.y}px` }} onClick={() => bustObject(obj.id)} />
              ))}
            </div>

            <div className="game-controls mt-4">
              {!gameStarted ? (
                <button onClick={startGame} disabled={!isConnected} className="start-btn">
                  🚀 Start Game
                </button>
              ) : (
                <div className="flex gap-3 justify-center">
                  <button onClick={gameOver ? startGame : quitGame} className={gameOver ? "start-btn" : "quit-btn"}>
                    {gameOver ? "🔄 Restart" : "❌ Quit"}
                  </button>

                  {gameStarted && !gameOver && (
                    <button onClick={togglePause} className="pause-btn">
                      {paused ? "▶️ Resume" : "⏸️ Pause"}
                    </button>
                  )}
                </div>
              )}
            </div>

            {gameOver && !scoreSaved && (
              <div className="game-over-screen">
                <h2>Game Over! 🎮</h2>
                <p>
                  Score: <span>{score}</span>
                </p>
                <p>
                  WMON Earned: <span>{(score * 0.01).toFixed(2)}</span>
                </p>

                <div className="gas-speed-section mb-4">
                  <button
                    className="gas-speed-selector"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowGasOptions(!showGasOptions);
                    }}
                  >
                    ⚡ Gas: {currentGasOptions.name}
                    {autoFillEnabled && <span className="auto-fill-indicator">🤖</span>}
                  </button>
                  <p className="text-xs opacity-70 mt-1">
                    Estimated: {currentGasOptions.estimatedTime}
                    {autoFillEnabled && " • Auto fill enabled"}
                  </p>
                </div>

                <div className="actions">
                  <button onClick={saveScoreAndAccumulate} disabled={isSavingScore} className="save-btn">
                    {isSavingScore ? (isAutoFilling ? "🤖 Auto-filling..." : "⏳ Saving...") : "💾 Save Score"}
                  </button>
                  <button onClick={startGame} className="play-again-btn">
                    🔄 Play Again
                  </button>
                </div>

                {pendingTxHash && (
                  <div className="mt-4 p-3 bg-blue-800 rounded-lg">
                    <p className="text-sm">⏳ Transaction submitted: {pendingTxHash.slice(0, 10)}...</p>
                    <p className="text-xs opacity-80">
                      Using Pimlico {currentGasOptions.name}
                      {autoFillEnabled && " • Auto fill ready"}
                    </p>
                    <button onClick={() => window.open(`https://testnet.monadexplorer.com/tx/${pendingTxHash}`, "_blank")} className="text-xs underline mt-1 text-yellow-300">
                      View on Explorer
                    </button>
                  </div>
                )}
              </div>
            )}

            {gameOver && scoreSaved && (
              <div className="game-over-screen">
                <h2>Score Saved! ✅</h2>
                <p>Your score of <span>{score}</span> has been saved!</p>
                <p>You earned <span>{(score * 0.01).toFixed(2)} WMON</span></p>
                <div className="actions">
                  <button onClick={startGame} className="play-again-btn">🎮 Play Again</button>
                </div>
              </div>
            )}
          </div>
        );
    }
  };

  return (
    <div className="game-app">
      {renderTransferModal()}
      {renderGasSpeedSelector()}

      <header className="game-header">
        <div className="header-left">
          <button className="menu-btn" onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}>
            ☰
          </button>
          {showMenu && (
            <div className="dropdown-menu" onClick={(e) => e.stopPropagation()}>
              <button className={`menu-item ${activeTab === "game" ? "active" : ""}`} onClick={() => { setActiveTab("game"); setShowMenu(false); }}>
                🎮 Play Game
              </button>
              <button className={`menu-item ${activeTab === "leaderboard" ? "active" : ""}`} onClick={() => { setActiveTab("leaderboard"); setShowMenu(false); }}>
                🏆 Leaderboard
              </button>
              <button className={`menu-item ${activeTab === "stats" ? "active" : ""}`} onClick={() => { setActiveTab("stats"); setShowMenu(false); }}>
                📊 My Stats
              </button>

              <div className="menu-divider"></div>

              <div className="auto-fill-section">
                <div className="auto-fill-header">
                  <span className="auto-fill-label">🤖 Auto-Fill Gas</span>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={autoFillEnabled} onChange={(e) => setAutoFillEnabled(e.target.checked)} />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
                <p className="auto-fill-description">Auto Fill Smart Acc if balance is low</p>
                {isAutoFilling && <div className="auto-fill-status">⚡ Auto-filling gas...</div>}
              </div>

              <div className="menu-divider"></div>

              <div className="balance-section">
                <h4 className="balance-title">💰 Balances</h4>

                <div className="balance-group">
                  <div className="balance-label">Main Wallet</div>
                  <div className="balance-item"><span>MON:</span><span className="balance-amount">{mainAccountMonBalance}</span></div>
                  <div className="balance-item"><span>WMON:</span><span className="balance-amount">{mainAccountWmonBalance}</span></div>
                  <div className="transfer-buttons-horizontal">
                    <button onClick={() => quickTransferToSmart("MON")} disabled={Number(mainAccountMonBalance) <= 0.01} className="transfer-btn-small to-smart" title="Send MON to Smart Account">⬇️ MON</button>
                    <button onClick={() => quickTransferToSmart("WMON")} disabled={Number(mainAccountWmonBalance) <= 0} className="transfer-btn-small to-smart" title="Send WMON to Smart Account">⬇️ WMON</button>
                  </div>
                </div>

                <div className="balance-group">
                  <div className="balance-label smart-account-label">
                    <span>Smart Account ⚡</span>
                    <button onClick={copyAddress} className="copy-address-btn" title="Copy Smart Account address">📋</button>
                  </div>
                  <div className="balance-item"><span>MON:</span><span className="balance-amount">{monBalance}</span></div>
                  <div className="balance-item"><span>WMON:</span><span className="balance-amount">{wmonBalance}</span></div>
                  <div className="transfer-buttons-horizontal">
                    <button onClick={() => quickTransferToMain("MON")} disabled={Number(monBalance) <= 0.01} className="transfer-btn-small to-main" title="Withdraw MON to Main Wallet">⬆️ MON</button>
                    <button onClick={() => quickTransferToMain("WMON")} disabled={Number(wmonBalance) <= 0} className="transfer-btn-small to-main" title="Withdraw WMON to Main Wallet">⬆️ WMON</button>
                  </div>
                </div>

                <div className="custom-transfer-section">
                  <button onClick={() => setShowTransferModal(true)} className="transfer-btn-small custom" title="Custom transfer to any address">🔄 Custom Transfer</button>
                </div>
              </div>

              <div className="menu-divider"></div>
              <button className="menu-item gas-settings" onClick={(e) => { e.stopPropagation(); setShowGasOptions(true); setShowMenu(false); }}>
                ⚡ Gas: {getCurrentGasOptions().name}
                {autoFillEnabled && <span style={{ marginLeft: "8px" }}>🤖</span>}
              </button>
            </div>
          )}
        </div>

        <div className="header-center">
          <h1>🎯 Ego Bust</h1>
        </div>

        <div className="header-right">
          {!gameStarted ? (
            <button onClick={startGame} disabled={!isConnected} className="start-btn header-start-btn">🚀 Start Game</button>
          ) : (
            <button onClick={quitGame} className="quit-btn header-quit-btn">❌ Quit</button>
          )}

          {isConnected ? (
            <div className="wallet-section">
              <div className="wallet-address-container">
                <button onClick={copyAddress} className="wallet-address" title={`${smartAccountAddress ? 'Smart Account' : 'Wallet'}: ${formatFullAddress(smartAccountAddress || address)}`}>
                  <span className="address-text">{formatAddress(smartAccountAddress || address)}</span>
                  {copiedAddress && <span className="copy-tooltip">Copied!</span>}
                  {smartAccountAddress && <span className="smart-indicator">⚡</span>}
                </button>
              </div>
              <button onClick={disconnectWallet} className="disconnect-btn">Disconnect</button>
            </div>
          ) : (
            <button onClick={connectWallet} disabled={isConnecting} className="connect-btn">
              {isConnecting ? "Connecting..." : "Connect Wallet"}
            </button>
          )}
        </div>
      </header>

      <main className="game-main">{renderContent()}</main>

      <footer className="game-footer">
        <p>Play to Earn on Monad Testnet</p>
        {smartAccountAddress && (
          <p style={{ color: "#fbbf24", fontSize: "0.7rem", marginTop: "0.5rem" }}>
            Smart Account: {smartAccountAddress} {autoFillEnabled && "• Auto fill enabled"}
          </p>
        )}
        {bundlerClient && (
          <p style={{ color: "#10B981", fontSize: "0.7rem", marginTop: "0.5rem" }}>
            Pimlico bundler • Gas: {getCurrentGasOptions().name} ({getCurrentGasOptions().gwei} gwei)
            {autoFillEnabled && " • Auto fill ready"}
          </p>
        )}
      </footer>
    </div>
  );
}

function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <GameApp />
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export default App;