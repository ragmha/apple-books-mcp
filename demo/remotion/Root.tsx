import { Composition } from "remotion";
import {
  DEMO_DURATION_IN_FRAMES,
  DEMO_FPS,
  DEMO_HEIGHT,
  DEMO_WIDTH,
} from "../script";
import { AppleBooksMcpDemo } from "./AppleBooksMcpDemo";

export function RemotionRoot() {
  return (
    <Composition
      component={AppleBooksMcpDemo}
      durationInFrames={DEMO_DURATION_IN_FRAMES}
      fps={DEMO_FPS}
      height={DEMO_HEIGHT}
      id="AppleBooksMcpDemo"
      width={DEMO_WIDTH}
    />
  );
}
