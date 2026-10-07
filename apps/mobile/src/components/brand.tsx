import Svg, { Path, Rect } from "react-native-svg";

import { useTheme } from "@/theme";

/** Zeichen: abgerundetes Quadrat mit drei steigenden Taktstrichen (wie auf der Website). */
export function BrandMark({ size = 32 }: { size?: number }) {
  const theme = useTheme();
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Rect x={1.5} y={1.5} width={29} height={29} rx={8.5} stroke={theme.text} strokeWidth={2} />
      <Path
        d="M10 21.5v-3M16 21.5v-7M22 21.5v-11"
        stroke={theme.text}
        strokeWidth={2.6}
        strokeLinecap="round"
      />
    </Svg>
  );
}
