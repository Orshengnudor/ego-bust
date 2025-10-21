import { useState, useEffect, useRef } from "react";
import { ethers } from "ethers";
import "./App.css";
import leaderboardABI from "./abi/EgoBustLeaderboard.json";

// WMON Token ABI
const WMON_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)"
];

// Reward Contract ABI
const REWARD_ABI = [
  "function addScore(uint256 _score) external",
  "function claimRewards() external",
  "function getPlayerStats(address player) external view returns (uint256 totalScore, uint256 totalGames, uint256 pendingRewards, uint256 totalClaimed, uint256 lastClaimedScore)",
  "function getLeaderboard() external view returns (tuple(address wallet, uint256 score, uint256 gamesPlayed, uint256 totalEarned)[])",
  "function getPendingRewards(address player) external view returns (uint256)",
  "event RewardsClaimed(address indexed player, uint256 score, uint256 amount)",
  "event ScoreAdded(address indexed player, uint256 score, uint256 gamesPlayed)"
];

const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS;
const WMON_ADDRESS = import.meta.env.VITE_WMON_ADDRESS;
const REWARD_CONTRACT_ADDRESS = import.meta.env.VITE_REWARD_CONTRACT_ADDRESS;

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
  
  // Web3 States
  const [account, setAccount] = useState(null);
  const [provider, setProvider] = useState(null);
  const [wmonBalance, setWmonBalance] = useState("0");
  const [pendingRewards, setPendingRewards] = useState(0);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [isSavingScore, setIsSavingScore] = useState(false);
  
  // Data States
  const [leaderboard, setLeaderboard] = useState([]);
  const [playerStats, setPlayerStats] = useState({
    totalScore: 0,
    totalGames: 0,
    pendingRewards: 0,
    totalClaimed: 0
  });

  const spawnIntervalRef = useRef(null);
  const cleanupIntervalRef = useRef(null);
  const gameAreaRef = useRef(null);

  const BASE_GAME_WIDTH = 320;
  const BASE_GAME_HEIGHT = 384;
  const IMAGE_SIZE = 35;
  const BORDER_WIDTH = 3;

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
    };

    if (showMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showMenu]);

  // Connect Metamask with better error handling
  const connectWallet = async () => {
    if (typeof window.ethereum !== 'undefined') {
      try {
        setIsConnecting(true);
        
        // Check if we need to handle any wallet conflicts
        if (window.ethereum.providers) {
          // Multiple wallets detected, use the first one
          window.ethereum = window.ethereum.providers.find(p => p.isMetaMask);
        }

        const accounts = await window.ethereum.request({
          method: 'eth_requestAccounts',
        });
        
        const web3Provider = new ethers.BrowserProvider(window.ethereum);
        setProvider(web3Provider);
        setAccount(accounts[0]);
        
        await loadWmonBalance(web3Provider, accounts[0]);
        await loadPlayerStats(web3Provider, accounts[0]);
        await loadLeaderboardData(web3Provider);
        
      } catch (error) {
        console.error("Connection error:", error);
        alert("Please connect your Metamask wallet to play!");
      } finally {
        setIsConnecting(false);
      }
    } else {
      alert('Metamask is not installed! Please install it to play.');
    }
  };

  const disconnectWallet = () => {
    setAccount(null);
    setProvider(null);
    setWmonBalance("0");
    setPendingRewards(0);
    setPlayerStats({
      totalScore: 0,
      totalGames: 0,
      pendingRewards: 0,
      totalClaimed: 0
    });
    setScoreSaved(false);
  };

  // Load WMON balance
  const loadWmonBalance = async (web3Provider, userAddress) => {
    try {
      const wmonContract = new ethers.Contract(WMON_ADDRESS, WMON_ABI, web3Provider);
      const balance = await wmonContract.balanceOf(userAddress);
      setWmonBalance(parseFloat(ethers.formatUnits(balance, 18)).toFixed(4));
    } catch (error) {
      console.error("Error loading WMON balance:", error);
    }
  };

  // Load player stats
  const loadPlayerStats = async (web3Provider, userAddress) => {
    if (!REWARD_CONTRACT_ADDRESS) return;
    
    try {
      const rewardContract = new ethers.Contract(REWARD_CONTRACT_ADDRESS, REWARD_ABI, web3Provider);
      const stats = await rewardContract.getPlayerStats(userAddress);
      
      setPlayerStats({
        totalScore: Number(stats.totalScore),
        totalGames: Number(stats.totalGames),
        pendingRewards: Number(ethers.formatUnits(stats.pendingRewards, 18)),
        totalClaimed: Number(ethers.formatUnits(stats.totalClaimed, 18))
      });
      
      setPendingRewards(Number(ethers.formatUnits(stats.pendingRewards, 18)));
    } catch (error) {
      console.error("Error loading player stats:", error);
    }
  };

  // Load leaderboard data
  const loadLeaderboardData = async (web3Provider) => {
    if (!REWARD_CONTRACT_ADDRESS) return;
    
    try {
      const rewardContract = new ethers.Contract(REWARD_CONTRACT_ADDRESS, REWARD_ABI, web3Provider);
      const data = await rewardContract.getLeaderboard();
      
      const formatted = data.map(entry => ({
        wallet: entry.wallet,
        score: Number(entry.score),
        gamesPlayed: Number(entry.gamesPlayed),
        totalEarned: Number(ethers.formatUnits(entry.totalEarned, 18))
      }));
      
      formatted.sort((a, b) => b.score - a.score);
      setLeaderboard(formatted);
    } catch (error) {
      console.error("Error loading leaderboard:", error);
    }
  };

  // Save score and accumulate rewards (WITH EXPLOIT FIX)
  const saveScoreAndAccumulate = async () => {
    if (!account || !provider || scoreSaved) return;
    
    try {
      setIsSavingScore(true);
      const signer = await provider.getSigner();
      const rewardContract = new ethers.Contract(REWARD_CONTRACT_ADDRESS, REWARD_ABI, signer);

      console.log("Saving score:", score);
      const tx = await rewardContract.addScore(score);
      console.log("Transaction sent:", tx.hash);
      
      await tx.wait();
      console.log("Transaction confirmed");
      
      // Mark score as saved to prevent multiple saves
      setScoreSaved(true);
      
      // Reload data
      await loadPlayerStats(provider, account);
      await loadLeaderboardData(provider);
      
      alert("Score saved successfully! 🎯");
      
    } catch (err) {
      console.error("Save score error:", err);
      alert("Failed to save score. Please try again. Make sure you're on the correct network.");
    } finally {
      setIsSavingScore(false);
    }
  };

  // Claim WMON rewards
  const claimRewards = async () => {
    if (!account || !provider) return;

    if (pendingRewards < 1) {
      alert(`You need at least 1 WMON to claim! Current: ${pendingRewards.toFixed(2)} WMON`);
      return;
    }

    try {
      setIsClaiming(true);
      const signer = await provider.getSigner();
      const rewardContract = new ethers.Contract(REWARD_CONTRACT_ADDRESS, REWARD_ABI, signer);
      
      const tx = await rewardContract.claimRewards();
      await tx.wait();
      
      alert(`🎉 Successfully claimed ${pendingRewards.toFixed(2)} WMON!`);
      
      await loadWmonBalance(provider, account);
      await loadPlayerStats(provider, account);
      await loadLeaderboardData(provider);
      
    } catch (error) {
      console.error("Error claiming rewards:", error);
      alert("Failed to claim rewards. Please try again.");
    } finally {
      setIsClaiming(false);
    }
  };

  // Game logic functions (same as before)
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

  const startGame = () => {
    if (!account) {
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
    setScoreSaved(false); // Reset score saved state
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
    
    // Add bust effect
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
                            entry.wallet.toLowerCase() === account?.toLowerCase() ? 'bg-purple-600' : ''
                          }`}
                        >
                          <td className="py-3 px-4 font-semibold">#{idx + 1}</td>
                          <td className="py-3 px-4 font-mono">
                            {entry.wallet.slice(0, 6)}...{entry.wallet.slice(-4)}
                            {entry.wallet.toLowerCase() === account?.toLowerCase() && (
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
                !account ? "opacity-50" : ""
              }`}
              ref={gameAreaRef}
            >
              {!account && (
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
                  disabled={!account}
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

            {/* Game Over Screen - Only show if score not saved yet */}
            {gameOver && !scoreSaved && (
              <div className="game-over-screen">
                <h2>Game Over! 🎮</h2>
                <p>Score: <span>{score}</span></p>
                <p>WMON Earned: <span>{(score * 0.01).toFixed(2)}</span></p>
                
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
              </div>
            )}

            {/* Show message if score already saved */}
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
      {/* Header - All in one line */}
      <header className="game-header">
        {/* Hamburger Menu */}
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

        {/* Game Title */}
        <div className="header-center">
          <h1>🎯 Ego Bust</h1>
        </div>

        {/* Start Game Button & Wallet Connection */}
        <div className="header-right">
          {!gameStarted ? (
            <button 
              onClick={startGame} 
              disabled={!account}
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
          
          {account ? (
            <div className="wallet-section">
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
              {isConnecting ? "Connecting..." : "Connect Wallet"}
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="game-main">
        {renderContent()}
      </main>

      {/* Footer */}
      <footer className="game-footer">
        <p>0.01 WMON per point | Min 1 WMON to claim | Rewards accumulate across games</p>
      </footer>
    </div>
  );
}

export default GameApp;