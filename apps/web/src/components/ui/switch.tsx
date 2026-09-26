import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import type * as React from 'react';

import { cn } from '@/lib/utils';

type SwitchProps = React.ComponentProps<typeof SwitchPrimitive.Root> & {
	size?: 'sm' | 'default';
};

function Switch(props: SwitchProps) {
	const rootProps = { ...props };
	delete rootProps.size;

	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			data-size={props.size ?? 'default'}
			className={cn(
				'peer group/switch inline-flex shrink-0 items-center rounded-full border border-transparent bg-input shadow-xs transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-[1.15rem] data-[size=default]:w-8 data-[size=sm]:h-3.5 data-[size=sm]:w-6 data-checked:bg-primary dark:bg-input/80',
				props.className,
			)}
			{...rootProps}
		>
			<SwitchPrimitive.Thumb
				data-slot="switch-thumb"
				className="pointer-events-none block rounded-full bg-background ring-0 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-checked:translate-x-[calc(100%-2px)] dark:data-checked:bg-primary-foreground"
			/>
		</SwitchPrimitive.Root>
	);
}

export { Switch };
