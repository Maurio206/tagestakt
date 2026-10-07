import { type Tone, goalStatusStyle, toneIcon } from "@tagestakt/design-tokens";
import { type GoalStatus } from "@tagestakt/schedule-schema";
import {
  Briefcase,
  Building,
  Calendar,
  CalendarCheck,
  Circle,
  CircleArrowUp,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  Dumbbell,
  Heart,
  type LucideIcon,
  TriangleAlert,
} from "lucide-react-native";

const ICONS: Readonly<Record<string, LucideIcon>> = {
  briefcase: Briefcase,
  dumbbell: Dumbbell,
  heart: Heart,
  building: Building,
  calendar: Calendar,
  circle: Circle,
  "circle-dashed": CircleDashed,
  "calendar-check": CalendarCheck,
  "triangle-alert": TriangleAlert,
  "circle-check": CircleCheck,
  "circle-arrow-up": CircleArrowUp,
  "circle-minus": CircleMinus,
};

interface IconProps {
  color: string;
  size?: number;
}

/** Dekoratives Symbol (für Screenreader ausgeblendet) – Bedeutung trägt immer Text. */
function NamedIcon({ name, color, size = 18 }: IconProps & { name: string }) {
  const Icon = ICONS[name] ?? Circle;
  return (
    <Icon
      color={color}
      size={size}
      strokeWidth={1.9}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

export function ToneIcon({ tone, ...rest }: IconProps & { tone: Tone }) {
  return <NamedIcon name={toneIcon[tone]} {...rest} />;
}

export function GoalStatusIcon({ status, ...rest }: IconProps & { status: GoalStatus }) {
  return <NamedIcon name={goalStatusStyle[status].icon} {...rest} />;
}
