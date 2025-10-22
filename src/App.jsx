import { useState, useEffect, useRef } from "react";
import { createConfig, http, useAccount, useConnect, useDisconnect, usePublicClient, useWalletClient } from "wagmi";
import { metaMask } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { 
  Implementation, 
  toMetaMaskSmartAccount
} from "@metamask/delegation-toolkit";
import { createBundlerClient } from "viem/account-abstraction";
import { parseEther, encodeFunctionData } from "viem";
import "./App.css";

// Monad Testnet Configuration
const monadTestnet = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: {
    decimals: 18,
    name: 'Monad',
    symbol: 'MON',
  },
  rpcUrls: {
    default: {
      http: ['https://monad-testnet.g.alchemy.com/v2/b5Q7A1uPLthyIDS1OsWo9'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Monad Testnet Explorer',
      url: 'https://testnet.monadexplorer.com',
    },
  },
  testnet: true,
};

const config = createConfig({
  chains: [monadTestnet],
  connectors: [
    metaMask(),
  ],
  transports: {
    [monadTestnet.id]: http(),
  },
});

const queryClient = new QueryClient();

// Fixed ABI definitions - proper format for Viem
const WMON_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }]
  },
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ type: 'bool' }]
  }
];

// Fixed Reward Contract ABI
const REWARD_ABI = [
  {
    name: 'addScore',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_score', type: 'uint256' }],
    outputs: []
  },
  {
    name: 'claimRewards',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: []
  },
  {
    name: 'getPlayerStats',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'player', type: 'address' }],
    outputs: [
      { name: 'totalScore', type: 'uint256' },
      { name: 'totalGames', type: 'uint256' },
      { name: 'pendingRewards', type: 'uint256' },
      { name: 'totalClaimed', type: 'uint256' },
      { name: 'lastClaimedScore', type: 'uint256' }
    ]
  },
  {
    name: 'getLeaderboard',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 'wallet', type: 'address' },
          { name: 'score', type: 'uint256' },
          { name: 'gamesPlayed', type: 'uint256' },
          { name: 'totalEarned', type: 'uint256' }
        ]
      }
    ]
  },
  {
    name: 'getPendingRewards',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'player', type: 'address' }],
    outputs: [{ type: 'uint256' }]
  },
  {
    type: 'event',
    name: 'RewardsClaimed',
    inputs: [
      { name: 'player', type: 'address', indexed: true },
      { name: 'score', type: 'uint256', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false }
    ]
  },
  {
    type: 'event',
    name: 'ScoreAdded',
    inputs: [
      { name: 'player', type: 'address', indexed: true },
      { name: 'score', type: 'uint256', indexed: false },
      { name: 'gamesPlayed', type: 'uint256', indexed: false }
    ]
  }
];

// Update these with your Monad testnet contract addresses
const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS;
const WMON_ADDRESS = import.meta.env.VITE_WMON_ADDRESS || "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701";
const REWARD_CONTRACT_ADDRESS = import.meta.env.VITE_REWARD_CONTRACT_ADDRESS || "0xa2B98D710AB9c0BC5aA4d21552B343A297C83dFF";

// Alchemy RPC URL for Monad Testnet
const ALCHEMY_RPC_URL = "https://monad-testnet.g.alchemy.com/v2/b5Q7A1uPLthyIDS1OsWo9";

// Gas speed options - similar to MetaMask
const GAS_SPEED_OPTIONS = {
  slow: {
    name: "🐢 Slow",
    maxFeePerGas: parseEther("0.0000001"), // 100 gwei
    maxPriorityFeePerGas: parseEther("0.0000001"), // 100 gwei
    description: "Lower cost, slower confirmation",
    estimatedTime: "2-5 min"
  },
  medium: {
    name: "⚡ Medium", 
    maxFeePerGas: parseEther("0.00000015"), // 150 gwei
    maxPriorityFeePerGas: parseEther("0.00000015"), // 150 gwei
    description: "Balanced speed and cost",
    estimatedTime: "1-2 min"
  },
  fast: {
    name: "🚀 Fast",
    maxFeePerGas: parseEther("0.0000002"), // 200 gwei
    maxPriorityFeePerGas: parseEther("0.0000002"), // 200 gwei
    description: "Faster confirmation",
    estimatedTime: "30-60 sec"
  },
  aggressive: {
    name: "🔥 Aggressive",
    maxFeePerGas: parseEther("0.0000003"), // 300 gwei
    maxPriorityFeePerGas: parseEther("0.0000003"), // 300 gwei
    description: "Highest priority, fastest confirmation",
    estimatedTime: "10-30 sec"
  }
};

const IMAGES = Array.from({ length: 221 }, (_, i) => `/images/${i}.png`);

function GameApp() {
  const [objects, setObjects] = useState([]);
  const [score, setScore] = useState(0);
  const [time, setTime] = useState(30);
  const [gameOver, setGameOver] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [clickedObjects, setClickedObjects] = useState(new Set());
  
  // UI States
  const [showMenu, setShowMenu] = useState(false);
  const [activeTab, setActiveTab] = useState('game');
  const [scoreSaved, setScoreSaved] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [showGasOptions, setShowGasOptions] = useState(false);
  const [selectedGasSpeed, setSelectedGasSpeed] = useState('medium'); // Default to medium
  
  // Web3 States with Smart Account
  const [smartAccount, setSmartAccount] = useState(null);
  const [smartAccountAddress, setSmartAccountAddress] = useState(null);
  const [bundlerClient, setBundlerClient] = useState(null);
  const [wmonBalance, setWmonBalance] = useState("0");
  const [pendingRewards, setPendingRewards] = useState(0);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [isSavingScore, setIsSavingScore] = useState(false);
  const [pendingTxHash, setPendingTxHash] = useState(null);
  
  // Data States
  const [leaderboard, setLeaderboard] = useState([]);
  const [playerStats, setPlayerStats] = useState({
    totalScore: 0,
    totalGames: 0,
    pendingRewards: 0,
    totalClaimed: 0
  });

  // Wagmi hooks
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const spawnIntervalRef = useRef(null);
  const cleanupIntervalRef = useRef(null);
  const gameAreaRef = useRef(null);

  const BASE_GAME_WIDTH = 320;
  const BASE_GAME_HEIGHT = 384;
  const IMAGE_SIZE = 35;
  const BORDER_WIDTH = 3;

  // Copy address to clipboard
  const copyAddress = async () => {
    const addressToCopy = smartAccountAddress || address;
    if (!addressToCopy) return;
    
    try {
      await navigator.clipboard.writeText(addressToCopy);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  // Format address for display
  const formatAddress = (addr) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  // Initialize Smart Account when wallet connects
  useEffect(() => {
    const initializeSmartAccount = async () => {
      if (!isConnected || !publicClient || !walletClient) return;

      try {
        setIsConnecting(true);
        
        // Create bundler client using Alchemy's RPC service on Monad Testnet
        const bundler = createBundlerClient({
          transport: http(ALCHEMY_RPC_URL),
        });

        setBundlerClient(bundler);

        // Create MetaMask Smart Account
        const addresses = await walletClient.getAddresses();
        const userAddress = addresses[0];

        const smartAcc = await toMetaMaskSmartAccount({
          client: publicClient,
          implementation: Implementation.Hybrid,
          deployParams: [userAddress, [], [], []],
          deploySalt: "0x",
          signer: { walletClient },
        });

        setSmartAccount(smartAcc);
        setSmartAccountAddress(smartAcc.address);
        
        await loadWmonBalance(smartAcc.address);
        await loadPlayerStats(smartAcc.address);
        await loadLeaderboardData();
        
        console.log("Smart Account initialized:", smartAcc.address);
        console.log("Bundler client initialized with Alchemy RPC");
        
      } catch (error) {
        console.error("Smart account initialization error:", error);
        console.log("Smart Account initialized but bundler might not be available:", error.message);
      } finally {
        setIsConnecting(false);
      }
    };

    initializeSmartAccount();
  }, [isConnected, publicClient, walletClient]);

  // Preload images
  useEffect(() => {
    IMAGES.forEach((src) => {
      const img = new Image();
      img.src = src;
    });
  }, []);

  // Reset score saved state when new game starts
  useEffect(() => {
    if (gameStarted) {
      setScoreSaved(false);
    }
  }, [gameStarted]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setShowMenu(false);
      setShowGasOptions(false);
    };

    if (showMenu || showGasOptions) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showMenu, showGasOptions]);

  // Connect with MetaMask Smart Account
  const connectWallet = async () => {
    try {
      setIsConnecting(true);
      connect({ connector: metaMask() });
    } catch (error) {
      console.error("Connection error:", error);
      alert("Please connect your MetaMask wallet to play!");
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectWallet = () => {
    disconnect();
    setSmartAccount(null);
    setSmartAccountAddress(null);
    setBundlerClient(null);
    setWmonBalance("0");
    setPendingRewards(0);
    setPlayerStats({
      totalScore: 0,
      totalGames: 0,
      pendingRewards: 0,
      totalClaimed: 0
    });
    setScoreSaved(false);
    setCopiedAddress(false);
    setPendingTxHash(null);
  };

  // Load WMON balance using Public Client
  const loadWmonBalance = async (userAddress) => {
    if (!publicClient || !WMON_ADDRESS) return;
    
    try {
      const balance = await publicClient.readContract({
        address: WMON_ADDRESS,
        abi: WMON_ABI,
        functionName: 'balanceOf',
        args: [userAddress],
      });
      setWmonBalance(parseFloat(balance.toString() / 1e18).toFixed(4));
    } catch (error) {
      console.error("Error loading WMON balance:", error);
    }
  };

  // Load player stats
  const loadPlayerStats = async (userAddress) => {
    if (!publicClient || !REWARD_CONTRACT_ADDRESS) return;
    
    try {
      const stats = await publicClient.readContract({
        address: REWARD_CONTRACT_ADDRESS,
        abi: REWARD_ABI,
        functionName: 'getPlayerStats',
        args: [userAddress],
      });
      
      setPlayerStats({
        totalScore: Number(stats[0]),
        totalGames: Number(stats[1]),
        pendingRewards: Number(stats[2]) / 1e18,
        totalClaimed: Number(stats[3]) / 1e18
      });
      
      setPendingRewards(Number(stats[2]) / 1e18);
    } catch (error) {
      console.error("Error loading player stats:", error);
    }
  };

  // Load leaderboard data
  const loadLeaderboardData = async () => {
    if (!publicClient || !REWARD_CONTRACT_ADDRESS) return;
    
    try {
      const data = await publicClient.readContract({
        address: REWARD_CONTRACT_ADDRESS,
        abi: REWARD_ABI,
        functionName: 'getLeaderboard',
      });
      
      const formatted = data.map(entry => ({
        wallet: entry.wallet,
        score: Number(entry.score),
        gamesPlayed: Number(entry.gamesPlayed),
        totalEarned: Number(entry.totalEarned) / 1e18
      }));
      
      formatted.sort((a, b) => b.score - a.score);
      setLeaderboard(formatted);
    } catch (error) {
      console.error("Error loading leaderboard:", error);
    }
  };

  // Save score using Smart Account User Operation
  const saveScoreAndAccumulate = async () => {
    if (!smartAccount || scoreSaved) return;
    
    try {
      setIsSavingScore(true);

      console.log("Saving score with smart account:", score);
      
      if (!bundlerClient) {
        alert("Bundler service not available. Please try again.");
        return;
      }

      // First, let's check if the Smart Account has funds
      const balance = await publicClient.getBalance({
        address: smartAccountAddress,
      });

      console.log("Smart Account balance:", balance.toString());

      // Get selected gas options
      const gasOptions = GAS_SPEED_OPTIONS[selectedGasSpeed];
      
      // Calculate estimated cost for the selected gas speed
      const estimatedGasCost = parseFloat(gasOptions.maxFeePerGas.toString() / 1e18) * 300000; // Rough estimate
      
      if (balance < parseEther(estimatedGasCost.toString())) {
        alert(`Your Smart Account needs MON tokens for gas! Current balance: ${parseFloat(balance.toString() / 1e18).toFixed(6)} MON. Please send at least ${estimatedGasCost.toFixed(6)} MON to your Smart Account address: ${smartAccountAddress}`);
        return;
      }

      console.log(`Using gas speed: ${gasOptions.name} (${gasOptions.maxFeePerGas.toString() / 1e9} gwei)`);

      const userOperationHash = await bundlerClient.sendUserOperation({
        account: smartAccount,
        calls: [
          {
            to: REWARD_CONTRACT_ADDRESS,
            data: encodeFunctionData({
              abi: REWARD_ABI,
              functionName: 'addScore',
              args: [score],
            }),
          },
        ],
        maxFeePerGas: gasOptions.maxFeePerGas,
        maxPriorityFeePerGas: gasOptions.maxPriorityFeePerGas,
      });

      console.log("User operation sent:", userOperationHash);
      setPendingTxHash(userOperationHash);
      
      // Wait for transaction receipt with timeout based on gas speed
      const timeout = selectedGasSpeed === 'aggressive' ? 30000 : 
                     selectedGasSpeed === 'fast' ? 45000 :
                     selectedGasSpeed === 'medium' ? 60000 : 90000;
      
      const { receipt } = await bundlerClient.waitForUserOperationReceipt({
        hash: userOperationHash,
        timeout: timeout,
      });
      
      console.log("Transaction confirmed:", receipt.transactionHash);
      
      // Mark score as saved to prevent multiple saves
      setScoreSaved(true);
      setPendingTxHash(null);
      
      // Reload data
      await loadPlayerStats(smartAccountAddress);
      await loadLeaderboardData();
      
      alert(`🎉 Score saved successfully with ${gasOptions.name} speed! Your WMON rewards have been accumulated.`);
      
    } catch (err) {
      console.error("Save score error:", err);
      
      if (err.message?.includes("timeout") || err.message?.includes("Timed out")) {
        alert(`Transaction is taking longer than expected with ${GAS_SPEED_OPTIONS[selectedGasSpeed].name} speed. It may still be processing. Please check the transaction status later or try a faster gas speed.`);
        // Don't mark as saved if it timed out - let user retry
      } else if (err.message?.includes("insufficient funds") || err.message?.includes("prefund")) {
        alert(`Your Smart Account needs MON tokens for gas! Please send MON to: ${smartAccountAddress}`);
      } else if (err.message?.includes("replacement underpriced")) {
        alert("Previous transaction is still pending. Please wait a few moments and try again.");
      } else if (err.message?.includes("maxFeePerGas") || err.message?.includes("gas")) {
        alert("Gas price issue detected. Please try again with a different gas speed.");
      } else {
        alert("Failed to save score. Please check the console for details.");
      }
    } finally {
      setIsSavingScore(false);
    }
  };

  // Claim WMON rewards using Smart Account
  const claimRewards = async () => {
    if (!smartAccount) return;

    if (pendingRewards < 1) {
      alert(`You need at least 1 WMON to claim! Current: ${pendingRewards.toFixed(2)} WMON`);
      return;
    }

    try {
      setIsClaiming(true);
      
      if (!bundlerClient) {
        alert("Bundler service not available. Cannot claim rewards with Smart Account.");
        return;
      }

      // Check Smart Account balance
      const balance = await publicClient.getBalance({
        address: smartAccountAddress,
      });

      // Get selected gas options
      const gasOptions = GAS_SPEED_OPTIONS[selectedGasSpeed];
      const estimatedGasCost = parseFloat(gasOptions.maxFeePerGas.toString() / 1e18) * 300000;

      if (balance < parseEther(estimatedGasCost.toString())) {
        alert(`Your Smart Account needs MON tokens for gas! Current balance: ${parseFloat(balance.toString() / 1e18).toFixed(6)} MON. Please send at least ${estimatedGasCost.toFixed(6)} MON to your Smart Account address: ${smartAccountAddress}`);
        return;
      }
      
      console.log(`Claiming rewards with gas speed: ${gasOptions.name}`);

      const userOperationHash = await bundlerClient.sendUserOperation({
        account: smartAccount,
        calls: [
          {
            to: REWARD_CONTRACT_ADDRESS,
            data: encodeFunctionData({
              abi: REWARD_ABI,
              functionName: 'claimRewards',
              args: [],
            }),
          },
        ],
        maxFeePerGas: gasOptions.maxFeePerGas,
        maxPriorityFeePerGas: gasOptions.maxPriorityFeePerGas,
      });

      const timeout = selectedGasSpeed === 'aggressive' ? 30000 : 
                     selectedGasSpeed === 'fast' ? 45000 :
                     selectedGasSpeed === 'medium' ? 60000 : 90000;

      const { receipt } = await bundlerClient.waitForUserOperationReceipt({
        hash: userOperationHash,
        timeout: timeout,
      });
      
      alert(`🎉 Successfully claimed ${pendingRewards.toFixed(2)} WMON with ${gasOptions.name} speed!`);
      
      await loadWmonBalance(smartAccountAddress);
      await loadPlayerStats(smartAccountAddress);
      await loadLeaderboardData();
      
    } catch (error) {
      console.error("Error claiming rewards:", error);
      if (error.message?.includes("insufficient funds") || error.message?.includes("prefund")) {
        alert(`Your Smart Account needs MON tokens for gas! Please send MON to: ${smartAccountAddress}`);
      } else if (error.message?.includes("maxFeePerGas") || error.message?.includes("gas")) {
        alert("Gas price issue detected. Please try again with a different gas speed.");
      } else if (error.message?.includes("replacement underpriced")) {
        alert("Previous transaction is still pending. Please wait a few moments and try again.");
      } else {
        alert("Failed to claim rewards. Please try again.");
      }
    } finally {
      setIsClaiming(false);
    }
  };

  // Game logic functions
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
          id: Date.now(),
          x: Math.floor(Math.random() * (width - IMAGE_SIZE - 2 * BORDER_WIDTH)),
          y: Math.floor(Math.random() * (height - IMAGE_SIZE - 2 * BORDER_WIDTH)),
          image: IMAGES[Math.floor(Math.random() * IMAGES.length)],
          spawnTime: Date.now(),
        };
        
        setObjects((prev) => {
          if (prev.length >= 30) {
            return [...prev.slice(1), newObj];
          }
          return [...prev, newObj];
        });
      }
    };

    spawnObject();
    spawnIntervalRef.current = setInterval(spawnObject, 200);
    
    return () => {
      if (spawnIntervalRef.current) {
        clearInterval(spawnIntervalRef.current);
      }
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
      setObjects((prev) =>
        prev.filter((obj) => currentTime - obj.spawnTime < 1000)
      );
    }, 100);

    return () => {
      if (cleanupIntervalRef.current) {
        clearInterval(cleanupIntervalRef.current);
      }
    };
  }, [gameStarted, gameOver, paused]);

  useEffect(() => {
    if (!gameStarted || gameOver || paused) return;
    
    if (time > 0) {
      const timer = setTimeout(() => setTime(time - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      setGameOver(true);
      setObjects([]);
    }
  }, [time, gameStarted, gameOver, paused]);

  // Game control functions
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

  const togglePause = () => {
    setPaused((prev) => !prev);
  };

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
      setScore((prev) => prev + 10);
    }, 300);
  };

  // Render Gas Speed Selector
  const renderGasSpeedSelector = () => {
    if (!showGasOptions) return null;

    return (
      <div className="gas-options-overlay" onClick={(e) => e.stopPropagation()}>
        <div className="gas-options-modal">
          <h3>⚡ Select Gas Speed</h3>
          <p className="gas-options-description">Choose transaction speed and cost</p>
          
          <div className="gas-options-list">
            {Object.entries(GAS_SPEED_OPTIONS).map(([key, option]) => (
              <div 
                key={key}
                className={`gas-option ${selectedGasSpeed === key ? 'selected' : ''}`}
                onClick={() => {
                  setSelectedGasSpeed(key);
                  setShowGasOptions(false);
                }}
              >
                <div className="gas-option-header">
                  <span className="gas-option-name">{option.name}</span>
                  <span className="gas-option-time">{option.estimatedTime}</span>
                </div>
                <div className="gas-option-details">
                  <span className="gas-price">{(option.maxFeePerGas.toString() / 1e9).toFixed(0)} gwei</span>
                  <span className="gas-description">{option.description}</span>
                </div>
              </div>
            ))}
          </div>
          
          <button 
            className="close-gas-options"
            onClick={() => setShowGasOptions(false)}
          >
            Close
          </button>
        </div>
      </div>
    );
  };

  // Render different content based on active tab
  const renderContent = () => {
    switch (activeTab) {
      case 'leaderboard':
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
                          className={`border-b border-purple-700 hover:bg-purple-700 transition-colors ${
                            entry.wallet.toLowerCase() === smartAccountAddress?.toLowerCase() ? 'bg-purple-600' : ''
                          }`}
                        >
                          <td className="py-3 px-4 font-semibold">#{idx + 1}</td>
                          <td className="py-3 px-4 font-mono">
                            {formatAddress(entry.wallet)}
                            {entry.wallet.toLowerCase() === smartAccountAddress?.toLowerCase() && (
                              <span className="ml-2 text-yellow-400">⭐</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right font-bold">{entry.score.toLocaleString()}</td>
                          <td className="py-3 px-4 text-right">{entry.gamesPlayed}</td>
                          <td className="py-3 px-4 text-right font-bold text-green-400">
                            {entry.totalEarned.toFixed(2)} WMON
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        );

      case 'stats':
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
                    ⚡ Gas: {GAS_SPEED_OPTIONS[selectedGasSpeed].name}
                  </button>
                </div>
                <button 
                  onClick={claimRewards}
                  disabled={isClaiming}
                  className="claim-btn text-xl"
                >
                  {isClaiming ? "⏳ Claiming..." : `🎁 Claim ${pendingRewards.toFixed(2)} WMON`}
                </button>
              </div>
            )}
          </div>
        );

      default: // 'game'
        return (
          <div className="game-container">
            {/* Game Stats */}
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

            {/* Game Area */}
            <div
              className={`relative overflow-hidden rounded-xl game-area ${paused ? "paused" : ""} ${
                !isConnected ? "opacity-50" : ""
              }`}
              ref={gameAreaRef}
            >
              {!isConnected && (
                <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-70 z-10">
                  <p className="text-white text-lg font-semibold">Connect Wallet to Play</p>
                </div>
              )}
              
              {objects.map((obj) => (
                <img
                  key={obj.id}
                  src={obj.image}
                  alt="object"
                  className={`game-object ${clickedObjects.has(obj.id) ? "pop-effect" : ""}`}
                  style={{
                    left: `${obj.x}px`,
                    top: `${obj.y}px`,
                  }}
                  onClick={() => bustObject(obj.id)}
                />
              ))}
            </div>

            {/* Game Controls */}
            <div className="game-controls mt-4">
              {!gameStarted ? (
                <button 
                  onClick={startGame} 
                  disabled={!isConnected}
                  className="start-btn"
                >
                  🚀 Start Game
                </button>
              ) : (
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={gameOver ? startGame : quitGame}
                    className={gameOver ? "start-btn" : "quit-btn"}
                  >
                    {gameOver ? "🔄 Restart" : "❌ Quit"}
                  </button>
                  
                  {gameStarted && !gameOver && (
                    <button 
                      onClick={togglePause}
                      className="pause-btn"
                    >
                      {paused ? "▶️ Resume" : "⏸️ Pause"}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Game Over Screen */}
            {gameOver && !scoreSaved && (
              <div className="game-over-screen">
                <h2>Game Over! 🎮</h2>
                <p>Score: <span>{score}</span></p>
                <p>WMON Earned: <span>{(score * 0.01).toFixed(2)}</span></p>
                
                <div className="gas-speed-section mb-4">
                  <button 
                    className="gas-speed-selector"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowGasOptions(!showGasOptions);
                    }}
                  >
                    ⚡ Gas: {GAS_SPEED_OPTIONS[selectedGasSpeed].name}
                  </button>
                  <p className="text-xs opacity-70 mt-1">
                    Estimated: {GAS_SPEED_OPTIONS[selectedGasSpeed].estimatedTime}
                  </p>
                </div>
                
                <div className="actions">
                  <button 
                    onClick={saveScoreAndAccumulate} 
                    disabled={isSavingScore}
                    className="save-btn"
                  >
                    {isSavingScore ? "⏳ Saving..." : "💾 Save Score"}
                  </button>
                  <button onClick={startGame} className="play-again-btn">
                    🔄 Play Again
                  </button>
                </div>
                {pendingTxHash && (
                  <div className="mt-4 p-3 bg-yellow-800 rounded-lg">
                    <p className="text-sm">⏳ Transaction pending: {pendingTxHash.slice(0, 10)}...</p>
                    <p className="text-xs opacity-80">Please wait for confirmation before trying again.</p>
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
                  <button onClick={startGame} className="play-again-btn">
                    🎮 Play Again
                  </button>
                </div>
              </div>
            )}
          </div>
        );
    }
  };

  return (
    <div className="game-app">
      {renderGasSpeedSelector()}
      
      <header className="game-header">
        <div className="header-left">
          <button 
            className="menu-btn"
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
          >
            ☰
          </button>
          {showMenu && (
            <div className="dropdown-menu" onClick={(e) => e.stopPropagation()}>
              <button 
                className={`menu-item ${activeTab === 'game' ? 'active' : ''}`}
                onClick={() => { setActiveTab('game'); setShowMenu(false); }}
              >
                🎮 Play Game
              </button>
              <button 
                className={`menu-item ${activeTab === 'leaderboard' ? 'active' : ''}`}
                onClick={() => { setActiveTab('leaderboard'); setShowMenu(false); }}
              >
                🏆 Leaderboard
              </button>
              <button 
                className={`menu-item ${activeTab === 'stats' ? 'active' : ''}`}
                onClick={() => { setActiveTab('stats'); setShowMenu(false); }}
              >
                📊 My Stats
              </button>
            </div>
          )}
        </div>

        <div className="header-center">
          <h1>🎯 Ego Bust</h1>
          {smartAccount && (
            <span className="smart-account-badge">⚡ Smart Account</span>
          )}
        </div>

        <div className="header-right">
          {!gameStarted ? (
            <button 
              onClick={startGame} 
              disabled={!isConnected}
              className="start-btn header-start-btn"
            >
              🚀 Start Game
            </button>
          ) : (
            <button
              onClick={quitGame}
              className="quit-btn header-quit-btn"
            >
              ❌ Quit
            </button>
          )}
          
          {isConnected ? (
            <div className="wallet-section">
              <div className="wallet-address-container">
                <button 
                  onClick={copyAddress}
                  className="wallet-address"
                  title="Click to copy Smart Account address"
                >
                  {formatAddress(smartAccountAddress)}
                  {copiedAddress && <span className="copy-tooltip">Copied!</span>}
                  <span className="smart-indicator">⚡</span>
                </button>
              </div>
              <span className="wallet-balance">{wmonBalance} WMON</span>
              <button onClick={disconnectWallet} className="disconnect-btn">
                Disconnect
              </button>
            </div>
          ) : (
            <button 
              onClick={connectWallet} 
              disabled={isConnecting}
              className="connect-btn"
            >
              {isConnecting ? "Connecting..." : "Connect Smart Account"}
            </button>
          )}
        </div>
      </header>

      <main className="game-main">
        {renderContent()}
      </main>

      <footer className="game-footer">
        <p>⚡ Powered by MetaMask Smart Accounts | Monad Testnet | 0.01 WMON per point | Min 1 WMON to claim</p>
        {smartAccount && (
          <p style={{color: '#fbbf24', fontSize: '0.7rem', marginTop: '0.5rem'}}>
            Smart Account: {smartAccountAddress} - Send MON to this address for gas
          </p>
        )}
        {bundlerClient && (
          <p style={{color: '#10B981', fontSize: '0.7rem', marginTop: '0.5rem'}}>
            ✅ Current gas speed: {GAS_SPEED_OPTIONS[selectedGasSpeed].name} ({(GAS_SPEED_OPTIONS[selectedGasSpeed].maxFeePerGas.toString() / 1e9).toFixed(0)} gwei)
          </p>
        )}
      </footer>
    </div>
  );
}

// Wrap with providers
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