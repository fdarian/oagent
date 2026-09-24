import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area';
import type * as React from 'react';

import { cn } from '@/lib/utils';

function ScrollArea(
	props: React.ComponentProps<typeof ScrollAreaPrimitive.Root>,
) {
	return (
		<ScrollAreaPrimitive.Root
			data-slot="scroll-area"
			className={cn('relative', props.className)}
			{...props}
		>
			<ScrollAreaPrimitive.Viewport
				data-slot="scroll-area-viewport"
				className="size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1"
			>
				<ScrollAreaPrimitive.Content>
					{props.children}
				</ScrollAreaPrimitive.Content>
			</ScrollAreaPrimitive.Viewport>
			<ScrollBar />
			<ScrollAreaPrimitive.Corner />
		</ScrollAreaPrimitive.Root>
	);
}

function ScrollBar(
	props: React.ComponentProps<typeof ScrollAreaPrimitive.Scrollbar>,
) {
	return (
		<ScrollAreaPrimitive.Scrollbar
			data-slot="scroll-area-scrollbar"
			orientation={props.orientation ?? 'vertical'}
			className={cn(
				'flex touch-none p-px transition-colors select-none',
				props.orientation === 'horizontal'
					? 'h-2.5 flex-col border-t border-t-transparent'
					: 'h-full w-2.5 border-l border-l-transparent',
				props.className,
			)}
			{...props}
		>
			<ScrollAreaPrimitive.Thumb
				data-slot="scroll-area-thumb"
				className="relative flex-1 rounded-full bg-border"
			/>
		</ScrollAreaPrimitive.Scrollbar>
	);
}

export { ScrollArea, ScrollBar };
