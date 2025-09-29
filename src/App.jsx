import { useState, useEffect, useRef } from "react";
import { ethers } from "ethers";
import "./App.css";
import leaderboardABI from "./abi/EgoBustLeaderboard.json";

const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS;
const MONAD_GAME_ID = import.meta.env.VITE_MONAD_GAME_ID;

// Images inside public/images (0.png → 220.png)
const IMAGES = Array.from({ length: 221 }, (_, i) => `/images/${i}.png`);

function GameApp() {
  const [objects, setObjects] = useState([]);
  const [score, setScore] = useState(0);
  const [time, setTime] = useState(30);
  const [gameOver, setGameOver] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [leaderboard, setLeaderboard] = useState([]);
  const [showFullLeaderboard, setShowFullLeaderboard] = useState(false);
  const [clickedObjects, setClickedObjects] = useState(new Set());
  const [loggedIn, setLoggedIn] = useState(false);
  const [playerId, setPlayerId] = useState(null);

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
    console.log("Preloaded 221 images");
  }, []);

  // Login with Monad Game ID
  const login = async () => {
    try {
      const res = await fetch("https://api.multisynq.io/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId: MONAD_GAME_ID }),
      });
      if (!res.ok) throw new Error("Login failed");
      const data = await res.json();
      setLoggedIn(true);
      setPlayerId(`${MONAD_GAME_ID}:${data.player?.id || "guest"}`);
    } catch (err) {
      console.error("Login error:", err);
      alert("Login failed");
    }
  };

  const logout = () => {
    setLoggedIn(false);
    setPlayerId(null);
  };

  // Spawn objects
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
        spawnIntervalRef.current = null;
      }
    };
  }, [gameStarted, gameOver, paused]);

  // Remove objects after 1s
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
        cleanupIntervalRef.current = null;
      }
    };
  }, [gameStarted, gameOver, paused]);

  // Timer
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
    setGameStarted(true);
    setGameOver(false);
    setPaused(false);
    setScore(0);
    setTime(30);
    setObjects([]);
    setClickedObjects(new Set());
  };

  const quitGame = () => {
    setGameStarted(false);
    setGameOver(false);
    setPaused(false);
    setObjects([]);
    setClickedObjects(new Set());
  };

  const togglePause = () => {
    setPaused((prev) => !prev);
  };

  // ✅ Prevent bust when paused
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

  // Save score
  const saveScore = async () => {
    if (!loggedIn || !playerId) return alert("Please login first!");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, leaderboardABI, signer);

      const tx = await contract.saveScore(score);
      await tx.wait();
      alert(`Score saved on-chain! Game ID: ${playerId}`);
      loadLeaderboard();
    } catch (err) {
      console.error("Save score error:", err);
      alert("Failed to save score");
    }
  };

  // Load leaderboard
  const loadLeaderboard = async () => {
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const contract = new ethers.Contract(CONTRACT_ADDRESS, leaderboardABI, provider);

      const data = await contract.getLeaderboard();
      const scoreMap = new Map();
      data.forEach((p) => {
        const wallet = p.wallet;
        const score = Number(p.score);
        if (!scoreMap.has(wallet) || score > scoreMap.get(wallet).score) {
          scoreMap.set(wallet, { wallet, score });
        }
      });
      const formatted = Array.from(scoreMap.values());
      formatted.sort((a, b) => b.score - a.score);
      setLeaderboard(formatted);
    } catch (err) {
      console.error("Load leaderboard error:", err);
    }
  };

  useEffect(() => {
    loadLeaderboard();
  }, []);

  const toggleLeaderboardView = () => {
    setShowFullLeaderboard((prev) => !prev);
  };

  const displayedLeaderboard = showFullLeaderboard ? leaderboard : leaderboard.slice(0, 5);

  return (
    <div className="bg-purple-900 text-white min-h-screen flex flex-col items-center gap-4">
      <h1 className="text-4xl font-bold">Ego Bust</h1>
      <div className="text-lg">Time: {time}s | Score: {score}</div>
      <div className="text-sm">
        {loggedIn && playerId ? `Game ID: ${playerId}` : "Not logged in"}
      </div>

      {/* Game Controls */}
      <div className="flex gap-4 flex-wrap justify-center">
        {!gameStarted ? (
          <button onClick={startGame} className="bg-green-600 px-4 py-2 rounded-lg">
            Start Game
          </button>
        ) : (
          <button
            onClick={gameOver ? startGame : quitGame}
            className={`px-4 py-2 rounded-lg ${gameOver ? "bg-green-600" : "bg-red-600"}`}
          >
            {gameOver ? "Restart" : "Quit Game"}
          </button>
        )}
        {gameStarted && !gameOver && (
          <button onClick={togglePause} className="bg-yellow-600 px-4 py-2 rounded-lg">
            {paused ? "Resume" : "Pause"}
          </button>
        )}
        <button
          onClick={loggedIn ? logout : login}
          className="bg-blue-600 px-4 py-2 rounded-lg wallet-button"
        >
          {loggedIn ? "Logout" : "Login with Monad Game ID"}
        </button>
      </div>

      {/* Game Area */}
      <div
        className={`relative overflow-hidden rounded-lg game-area ${paused ? "paused" : ""}`}
        ref={gameAreaRef}
      >
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

      {/* Game Over Screen */}
      {gameOver && (
        <div className="text-center">
          <p className="text-xl mb-2">Game Over! Final Score: {score}</p>
          <button onClick={saveScore} className="bg-green-600 px-4 py-2 rounded-lg">
            Save Score
          </button>
        </div>
      )}

      {/* Leaderboard */}
      <div className="leaderboard-card w-80 bg-purple-700 p-4 rounded-lg shadow-md">
        <h2 className="text-lg font-bold mb-2">Leaderboard</h2>
        {leaderboard.length === 0 ? (
          <p>No scores yet</p>
        ) : (
          <>
            <table className="w-full text-sm leaderboard-table">
              <thead>
                <tr>
                  <th className="text-left px-2 py-1">Address</th>
                  <th className="text-right px-2 py-1">Score</th>
                </tr>
              </thead>
              <tbody>
                {displayedLeaderboard.map((p, idx) => (
                  <tr key={idx}>
                    <td className="px-2 py-1">{p.wallet.slice(0, 6)}...{p.wallet.slice(-4)}</td>
                    <td className="text-right px-2 py-1">{p.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {leaderboard.length > 5 && (
              <button
                onClick={toggleLeaderboardView}
                className="bg-blue-600 px-4 py-2 rounded-lg mt-4 w-full"
              >
                {showFullLeaderboard ? "Show Top 5" : "View Full Leaderboard"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default GameApp;
