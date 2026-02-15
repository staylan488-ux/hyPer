import { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/components/shared';
import { springs } from '@/lib/animations';

interface RestTimerProps {
  onComplete: () => void;
  defaultSeconds?: number;
}

const PRESET_TIMES = [60, 90, 120, 180, 300];

export function RestTimer({ onComplete, defaultSeconds = 90 }: RestTimerProps) {
  const [seconds, setSeconds] = useState(defaultSeconds);
  const [timeLeft, setTimeLeft] = useState(defaultSeconds);
  const [isRunning, setIsRunning] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isRunning || timeLeft <= 0) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          if ('vibrate' in navigator) {
            navigator.vibrate([200, 100, 200]);
          }
          setIsRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isRunning, timeLeft]);

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const progress = ((seconds - timeLeft) / seconds) * 100;
  const isWarning = timeLeft <= 10 && timeLeft > 0 && isRunning;
  const isComplete = timeLeft === 0;

  const handleReset = () => {
    setTimeLeft(seconds);
    setIsRunning(false);
  };

  const handleSetTime = (newSeconds: number) => {
    setSeconds(newSeconds);
    setTimeLeft(newSeconds);
    setIsRunning(true);
  };

  return (
    <div className="text-center py-4">
      {/* Timer display */}
      <motion.div
        className="relative w-44 h-44 mx-auto mb-8"
        animate={isWarning ? { scale: [1, 1.02, 1] } : {}}
        transition={isWarning ? { duration: 1, repeat: Infinity } : {}}
      >
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle
            className="text-[#2E2E2E]"
            stroke="currentColor"
            strokeWidth="3"
            fill="none"
            r="44"
            cx="50"
            cy="50"
          />
          <motion.circle
            stroke={isComplete ? '#8B9A7D' : '#E8E4DE'}
            strokeWidth="3"
            fill="none"
            r="44"
            cx="50"
            cy="50"
            strokeDasharray="276"
            strokeDashoffset={276 - (progress / 100) * 276}
            strokeLinecap="round"
            initial={{ strokeDashoffset: 276 }}
            animate={{ strokeDashoffset: 276 - (progress / 100) * 276 }}
            transition={{ duration: 1, ease: 'linear' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-display tabular-nums text-[#E8E4DE] tracking-tight">
            {formatTime(timeLeft)}
          </span>
          <span className="text-[9px] tracking-[0.2em] uppercase text-[#6B6B6B] mt-1">
            {isRunning ? 'Remaining' : isComplete ? 'Complete' : 'Paused'}
          </span>
        </div>
      </motion.div>

      {/* Controls */}
      <div className="flex justify-center gap-3 mb-8">
        <motion.button
          className="w-14 h-14 rounded-[20px] bg-[#2E2E2E] border border-white/5 flex items-center justify-center hover:bg-[#383838] transition-colors"
          onClick={() => setIsRunning(!isRunning)}
          whileTap={{ scale: 0.9 }}
          transition={springs.snappy}
        >
          {isRunning ? (
            <Pause className="w-5 h-5 text-[#E8E4DE]" />
          ) : (
            <Play className="w-5 h-5 text-[#E8E4DE]" fill="currentColor" />
          )}
        </motion.button>
        <motion.button
          className="w-14 h-14 rounded-[20px] bg-transparent border border-white/10 flex items-center justify-center hover:bg-white/5 transition-colors"
          onClick={handleReset}
          whileTap={{ scale: 0.9, rotate: -180 }}
          transition={springs.snappy}
        >
          <RotateCcw className="w-5 h-5 text-[#6B6B6B]" />
        </motion.button>
      </div>

      {/* Preset times */}
      <div className="flex flex-wrap justify-center gap-2 mb-8">
        {PRESET_TIMES.map((preset) => (
          <motion.button
            key={preset}
            className={`px-4 py-2 rounded-[16px] text-[10px] tracking-[0.1em] uppercase transition-all ${
              seconds === preset
                ? 'bg-[#E8E4DE] text-[#1A1A1A]'
                : 'bg-transparent text-[#6B6B6B] border border-white/10 hover:border-white/20'
            }`}
            onClick={() => handleSetTime(preset)}
            whileTap={{ scale: 0.95 }}
            transition={springs.snappy}
          >
            {preset >= 60 ? `${preset / 60}m` : `${preset}s`}
          </motion.button>
        ))}
      </div>

      <Button variant="secondary" onClick={onComplete} className="w-full">
        Continue
      </Button>
    </div>
  );
}
