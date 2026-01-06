import React, { useState, useRef, ChangeEvent } from 'react';

interface ImageComparisonSliderProps {
  original: string;
  modified: string;
  originalLabel?: string;
  modifiedLabel?: string;
  className?: string;
}

const ImageComparisonSlider: React.FC<ImageComparisonSliderProps> = ({
  original,
  modified,
  originalLabel = 'Original',
  modifiedLabel = 'Modified',
  className = ''
}) => {
  const [position, setPosition] = useState(50);
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setPosition(Number(e.target.value));
  };

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* Base image */}
      <img src={original} alt={originalLabel} className="block w-full h-auto" />
      {/* Overlay image clipped by slider */}
      <div
        className="absolute top-0 left-0 h-full overflow-hidden"
        style={{ width: `${position}%` }}
      >
        <img src={modified} alt={modifiedLabel} className="block w-full h-auto" />
      </div>
      {/* Slider control */}
      <input
        type="range"
        min="0"
        max="100"
        value={position}
        onChange={handleChange}
        className="absolute bottom-2 left-0 w-full cursor-pointer bg-transparent appearance-none"
      />
    </div>
  );
};

export default ImageComparisonSlider;
