import React from 'react';
import { motion } from 'framer-motion';
import { Play, Pause, RotateCcw, SkipBack, SkipForward } from 'lucide-react';

interface TimelineControlsProps {
  currentIndex: number;
  totalSteps: number;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onReset: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onSeek: (index: number) => void;
}

const TimelineControls: React.FC<TimelineControlsProps> = ({
  currentIndex,
  totalSteps,
  isPlaying,
  onPlay,
  onPause,
  onReset,
  onStepBack,
  onStepForward,
  onSeek,
}) => {
  const progress = totalSteps > 0 ? (currentIndex / (totalSteps - 1)) * 100 : 0;

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10);
    onSeek(value);
  };

  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.3 }}
      className="fixed bottom-8 left-1/2 transform -translate-x-1/2 z-50"
    >
      <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-gray-200 p-4 min-w-[500px]">
        
        {/* Progress Bar */}
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs text-gray-600 mb-2">
            <span className="font-mono">Step {currentIndex + 1} / {totalSteps}</span>
            <span className="font-mono">{Math.round(progress)}%</span>
          </div>
          
          {/* Custom Slider */}
          <div className="relative h-2 bg-gray-200 rounded-full overflow-hidden">
            {/* Progress Fill */}
            <motion.div
              className="absolute top-0 left-0 h-full bg-gradient-to-r from-cyan-400 to-cyan-500"
              style={{ width: `${progress}%` }}
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.2 }}
            />
            
            {/* Slider Input (invisible but functional) */}
            <input
              type="range"
              min="0"
              max={totalSteps - 1}
              value={currentIndex}
              onChange={handleSliderChange}
              className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
            />
            
            {/* Slider Thumb */}
            <motion.div
              className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white border-2 border-cyan-500 rounded-full shadow-lg cursor-pointer pointer-events-none"
              style={{ left: `${progress}%` }}
              animate={{ left: `${progress}%` }}
              transition={{ duration: 0.2 }}
            />
          </div>
        </div>

        {/* Control Buttons */}
        <div className="flex items-center justify-center gap-2">
          
          {/* Reset */}
          <button
            onClick={onReset}
            disabled={currentIndex === 0}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Reset to start"
          >
            <RotateCcw size={18} className="text-gray-700" />
          </button>

          {/* Step Back */}
          <button
            onClick={onStepBack}
            disabled={currentIndex === 0}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Previous step"
          >
            <SkipBack size={18} className="text-gray-700" />
          </button>

          {/* Play/Pause */}
          <button
            onClick={isPlaying ? onPause : onPlay}
            disabled={currentIndex >= totalSteps - 1 && !isPlaying}
            className="p-4 bg-gradient-to-r from-cyan-500 to-cyan-600 hover:from-cyan-600 hover:to-cyan-700 rounded-xl shadow-md transition-all hover:shadow-lg active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause size={24} className="text-white" fill="white" />
            ) : (
              <Play size={24} className="text-white" fill="white" />
            )}
          </button>

          {/* Step Forward */}
          <button
            onClick={onStepForward}
            disabled={currentIndex >= totalSteps - 1}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Next step"
          >
            <SkipForward size={18} className="text-gray-700" />
          </button>

          {/* Speed Control (Optional) */}
          <div className="ml-4 flex items-center gap-2">
            <span className="text-xs text-gray-600">Speed:</span>
            <select
              className="text-xs bg-gray-50 border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-cyan-400"
              defaultValue="1"
            >
              <option value="0.5">0.5x</option>
              <option value="1">1x</option>
              <option value="1.5">1.5x</option>
              <option value="2">2x</option>
            </select>
          </div>
        </div>

        {/* Helper Text */}
        <p className="text-xs text-center text-gray-500 mt-3">
          {isPlaying 
            ? 'Watching conversation unfold...' 
            : currentIndex >= totalSteps - 1
            ? 'Playback complete'
            : 'Click play to watch the conversation timeline'}
        </p>
      </div>
    </motion.div>
  );
};

export default TimelineControls;