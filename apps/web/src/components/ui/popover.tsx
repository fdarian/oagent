import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import type * as React from 'react';
import { cn } from '@/lib/utils';

function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>) {
	return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger(
	props: React.ComponentProps<typeof PopoverPrimitive.Trigger>,
) {
	return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

type PopoverContentProps = React.ComponentProps<typeof PopoverPrimitive.Popup> &
	Pick<
		React.ComponentProps<typeof PopoverPrimitive.Positioner>,
		'align' | 'alignOffset' | 'side' | 'sideOffset'
	>;

function PopoverContent(props: PopoverContentProps) {
	const popupProps = { ...props };
	delete popupProps.align;
	delete popupProps.alignOffset;
	delete popupProps.side;
	delete popupProps.sideOffset;

	return (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Positioner
				align={props.align ?? 'center'}
				alignOffset={props.alignOffset}
				side={props.side}
				sideOffset={props.sideOffset ?? 4}
				className="z-50"
			>
				<PopoverPrimitive.Popup
					data-slot="popover-content"
					className={cn(
						'w-72 origin-(--transform-origin) rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[starting-style]:animate-in data-[starting-style]:fade-in-0 data-[starting-style]:zoom-in-95 data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95',
						props.className,
					)}
					{...popupProps}
				/>
			</PopoverPrimitive.Positioner>
		</PopoverPrimitive.Portal>
	);
}

function PopoverAnchor(props: React.ComponentProps<'div'>) {
	return <div data-slot="popover-anchor" {...props} />;
}

function PopoverHeader(props: React.ComponentProps<'div'>) {
	return (
		<div
			data-slot="popover-header"
			className={cn('flex flex-col gap-1 text-sm', props.className)}
			{...props}
		/>
	);
}

function PopoverTitle(props: React.ComponentProps<'h2'>) {
	return (
		<h2
			data-slot="popover-title"
			className={cn('font-medium', props.className)}
			{...props}
		/>
	);
}

function PopoverDescription(props: React.ComponentProps<'p'>) {
	return (
		<p
			data-slot="popover-description"
			className={cn('text-muted-foreground', props.className)}
			{...props}
		/>
	);
}

export {
	Popover,
	PopoverAnchor,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
};
