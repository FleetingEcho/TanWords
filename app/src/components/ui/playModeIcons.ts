import { PlayOrderIcon, RepeatIcon, RepeatOneIcon, ShuffleIcon } from "@/components/ui/icons";
import type { PlayMode } from "@/features/music/queue";

export const MODE_ICONS: Record<PlayMode, React.FC<{ className?: string }>> = {
  order: PlayOrderIcon,
  "loop-one": RepeatOneIcon,
  "loop-all": RepeatIcon,
  shuffle: ShuffleIcon,
};
