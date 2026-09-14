import React from "react";
import Slider, { SliderProps } from "@mui/material/Slider";
import styled from "@mui/material/styles/styled";

import { formatVolumeLabel, gainToSlider, sliderToGain } from "./volume";

const StyledSlider = styled(Slider)({
  color: "#fff",
  "& .MuiSlider-track": {
    border: "none",
  },
  "& .MuiSlider-thumb": {
    width: 24,
    height: 24,
    backgroundColor: "#fff",
    "&:hover, &.Mui-focusVisible, &.Mui-active": {
      boxShadow: "0 4px 8px rgba(0,0,0,0.4)",
    },
  },
});

/** deltaY reported by one detent of a conventional mouse wheel. */
const WHEEL_NOTCH = 100;

type VolumeSliderProps = Omit<SliderProps, "value" | "onChange"> & {
  /** Amplitude from state, 0-1. */
  gain: number;
  onGainChange: (gain: number) => void;
  /**
   * Position change for a full wheel notch. Leave unset to ignore the wheel —
   * only safe outside of scrollable containers.
   */
  wheelStep?: number;
};

export function VolumeSlider({
  gain,
  onGainChange,
  wheelStep,
  ...props
}: VolumeSliderProps) {
  const position = gainToSlider(gain);

  function handleChange(_: Event, value: number | number[]) {
    if (!Array.isArray(value)) {
      onGainChange(sliderToGain(value));
    }
  }

  function handleWheel(event: React.WheelEvent) {
    if (!wheelStep || event.deltaY === 0) {
      return;
    }
    // Scale by the delta instead of stepping per event: a trackpad fires dozens
    // of small deltas where a mouse wheel fires one notch of ~100.
    const notches = Math.max(-1, Math.min(1, -event.deltaY / WHEEL_NOTCH));
    onGainChange(sliderToGain(position + notches * wheelStep));
  }

  return (
    <StyledSlider
      value={position}
      step={0.01}
      min={0}
      max={1}
      valueLabelDisplay="auto"
      valueLabelFormat={formatVolumeLabel}
      onChange={handleChange}
      onWheel={wheelStep ? handleWheel : undefined}
      {...props}
    />
  );
}
