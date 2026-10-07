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
  type LucideProps,
  TriangleAlert,
} from "lucide-react";

/** Lucide-Symbole, auf die die Design-Tokens per Name verweisen. */
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

type IconProps = Omit<LucideProps, "ref">;

/** Dekoratives Symbol: Bedeutung trägt immer der begleitende Text. */
function NamedIcon({ name, size = 18, ...rest }: IconProps & { name: string }) {
  const Icon = ICONS[name] ?? Circle;
  return <Icon size={size} strokeWidth={1.9} aria-hidden="true" className="icon" {...rest} />;
}

export function ToneIcon({ tone, ...rest }: IconProps & { tone: Tone }) {
  return <NamedIcon name={toneIcon[tone]} {...rest} />;
}

export function GoalStatusIcon({ status, ...rest }: IconProps & { status: GoalStatus }) {
  return <NamedIcon name={goalStatusStyle[status].icon} {...rest} />;
}
