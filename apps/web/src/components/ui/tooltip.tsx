import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import type * as React from 'react';
import { cn } from '@/lib/utils';

function TooltipProvider(
	props: React.ComponentProps<typeof TooltipPrimitive.Provider>,
) {
	return <TooltipPrimitive.Provider delay={props.delay ?? 0} {...props} />;
}

function Tooltip(props: React.ComponentProps<typeof TooltipPrimitive.Root>) {
	return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger(
	props: React.ComponentProps<typeof TooltipPrimitive.Trigger>,
) {
	return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

type TooltipContentProps = React.ComponentProps<typeof TooltipPrimitive.Popup> &
	Pick<
		React.ComponentProps<typeof TooltipPrimitive.Positioner>,
		'align' | 'alignOffset' | 'side' | 'sideOffset'
	>;

function TooltipContent(props: TooltipContentProps) {
	const popupProps = { ...props };
	delete popupProps.align;
	delete popupProps.alignOffset;
	delete popupProps.side;
	delete popupProps.sideOffset;
	delete popupProps.className;

	return (
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Positioner
				align={props.align}
				alignOffset={props.alignOffset}
				side={props.side}
				sideOffset={props.sideOffset ?? 0}
				className="isolate z-[60]"
			>
				<TooltipPrimitive.Popup
					{...popupProps}
					data-slot="tooltip-content"
					className={cn(
						'w-fit origin-(--transform-origin) animate-in rounded-md bg-foreground px-3 py-1.5 text-xs text-balance text-background fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[starting-style]:animate-in data-[starting-style]:fade-in-0 data-[starting-style]:zoom-in-95 data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95',
						props.className,
					)}
				>
					{props.children}
					<TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground" />
				</TooltipPrimitive.Popup>
			</TooltipPrimitive.Positioner>
		</TooltipPrimitive.Portal>
	);
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
