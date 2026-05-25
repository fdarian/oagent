import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

const icons = {
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon,
};

const labels: Record<string, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const ActiveIcon = icons[theme];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex items-center justify-center rounded-md border border-transparent p-1.5 text-muted-foreground transition-colors hover:border-border hover:text-foreground',
          className,
        )}
      >
        <ActiveIcon className="size-4" />
        <span className="sr-only">Toggle theme</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {(['light', 'dark', 'system'] as const).map((t) => {
          const Icon = icons[t];
          return (
            <DropdownMenuItem
              key={t}
              className="gap-2"
              onClick={() => setTheme(t)}
            >
              <Icon className="size-4" />
              {labels[t]}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
