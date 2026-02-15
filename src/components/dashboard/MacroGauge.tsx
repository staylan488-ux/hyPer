import { useEffect, useState } from 'react';
import { motion, useSpring, useTransform } from 'motion/react';

interface MacroGaugeProps {
  label: string;
  current: number;
  target: number;
  unit: string;
  color?: 'default' | 'accent' | 'sage' | 'rose';
}

export function MacroGauge({ label, current, target, unit, color = 'default' }: MacroGaugeProps) {
  const percentage = Math.min((current / target) * 100, 100);
  const isOver = current > target;
  const isHit = percentage >= 100;

  const strokeColors = {
    default: '#6B6B6B',
    accent: '#C4A484',
    sage: '#8B9A7D',
    rose: '#A68B8B',
  };

  // Animated count-up
  const spring = useSpring(0, { stiffness: 60, damping: 20 });
  const displayValue = useTransform(spring, (v) => Math.round(v));
  const [countValue, setCountValue] = useState(0);

  useEffect(() => {
    spring.set(current);
    const unsubscribe = displayValue.on('change', (v) => setCountValue(v));
    return unsubscribe;
  }, [current, spring, displayValue]);

  // Animated arc
  const arcSpring = useSpring(0, { stiffness: 60, damping: 20 });
  const [arcValue, setArcValue] = useState(0);

  useEffect(() => {
    arcSpring.set(percentage * 0.977);
    const unsubscribe = arcSpring.on('change', (v) => setArcValue(v));
    return unsubscribe;
  }, [percentage, arcSpring]);

  return (
    <div className={`flex flex-col items-center p-3 rounded-[20px] bg-[#242424] border border-white/5 ${isHit ? 'animate-pulse-glow' : ''}`}>
      <p className="text-[9px] tracking-[0.2em] uppercase text-[#6B6B6B] mb-2">{label}</p>

      <div className="relative h-14 w-14">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
          {/* Background track */}
          <circle
            className="text-[#2E2E2E]"
            stroke="currentColor"
            strokeWidth="2.5"
            fill="none"
            r="15.5"
            cx="18"
            cy="18"
          />
          {/* Progress arc */}
          <circle
            stroke={isOver ? '#8B6B6B' : strokeColors[color]}
            strokeWidth="2.5"
            fill="none"
            r="15.5"
            cx="18"
            cy="18"
            strokeDasharray={`${arcValue} 100`}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs font-display text-[#E8E4DE] tabular-nums">
            {Math.round(percentage)}%
          </span>
        </div>
      </div>

      <p className="text-[10px] text-[#9A9A9A] mt-2 tabular-nums">
        <motion.span className="text-[#E8E4DE]">{countValue}</motion.span>
        <span className="text-[#6B6B6B]">/{target}{unit}</span>
      </p>
    </div>
  );
}
