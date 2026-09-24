import { PreviewCard as HoverCardPrimitive } from '@base-ui/react/preview-card';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { type AsChild, asChildProps } from './as-child';

const HoverCardDelay = React.createContext<{
	openDelay?: number;
	closeDelay?: number;
}>({});

function HoverCard(
	props: React.ComponentProps<typeof HoverCardPrimitive.Root> & {
		openDelay?: number;
		closeDelay?: number;
	},
) {
	const rootProps = { ...props };
	delete rootProps.openDelay;
	delete rootProps.closeDelay;
	return (
		<HoverCardDelay.Provider
			value={{ openDelay: props.openDelay, closeDelay: props.closeDelay }}
		>
			<HoverCardPrimitive.Root {...rootProps} />
		</HoverCardDelay.Provider>
	);
}

function HoverCardTrigger(
	props: React.ComponentProps<typeof HoverCardPrimitive.Trigger> & AsChild,
) {
	const delay = React.useContext(HoverCardDelay);
	return (
		<HoverCardPrimitive.Trigger
			data-slot="hover-card-trigger"
			delay={delay.openDelay}
			closeDelay={delay.closeDelay}
			{...asChildProps(props)}
		/>
	);
}

type HoverCardContentProps = React.ComponentProps<
	typeof HoverCardPrimitive.Popup
> &
	Pick<
		React.ComponentProps<typeof HoverCardPrimitive.Positioner>,
		'align' | 'alignOffset' | 'side' | 'sideOffset'
	>;

function HoverCardContent(props: HoverCardContentProps) {
	const popupProps = { ...props };
	delete popupProps.align;
	delete popupProps.alignOffset;
	delete popupProps.side;
	delete popupProps.sideOffset;

	return (
		<HoverCardPrimitive.Portal data-slot="hover-card-portal">
			<HoverCardPrimitive.Positioner
				align={props.align ?? 'center'}
				alignOffset={props.alignOffset}
				side={props.side}
				sideOffset={props.sideOffset ?? 4}
				className="z-50"
			>
				<HoverCardPrimitive.Popup
					data-slot="hover-card-content"
					className={cn(
						'w-64 origin-(--transform-origin) rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[starting-style]:animate-in data-[starting-style]:fade-in-0 data-[starting-style]:zoom-in-95 data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95',
						props.className,
					)}
					{...popupProps}
				/>
			</HoverCardPrimitive.Positioner>
		</HoverCardPrimitive.Portal>
	);
}

export { HoverCard, HoverCardContent, HoverCardTrigger };
