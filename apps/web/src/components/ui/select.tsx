'use client';

import { Select as SelectPrimitive } from '@base-ui/react/select';
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import type * as React from 'react';

import { cn } from '@/lib/utils';

function Select(
	props: Omit<
		React.ComponentProps<typeof SelectPrimitive.Root<string>>,
		'onValueChange'
	> & { onValueChange?: (value: string) => void },
) {
	const rootProps = { ...props };
	delete rootProps.onValueChange;
	return (
		<SelectPrimitive.Root
			data-slot="select"
			{...rootProps}
			onValueChange={(value) => {
				if (value !== null) props.onValueChange?.(value);
			}}
		/>
	);
}

function SelectGroup(
	props: React.ComponentProps<typeof SelectPrimitive.Group>,
) {
	return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectValue(
	props: React.ComponentProps<typeof SelectPrimitive.Value>,
) {
	return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

type SelectTriggerProps = React.ComponentProps<
	typeof SelectPrimitive.Trigger
> & {
	size?: 'sm' | 'default';
};

function SelectTrigger(props: SelectTriggerProps) {
	const triggerProps = { ...props };
	delete triggerProps.size;

	return (
		<SelectPrimitive.Trigger
			data-slot="select-trigger"
			data-size={props.size ?? 'default'}
			className={cn(
				"flex w-fit items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[placeholder]:text-muted-foreground data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
				props.className,
			)}
			{...triggerProps}
		>
			{props.children}
			<SelectPrimitive.Icon
				render={<ChevronDownIcon className="size-4 opacity-50" />}
			/>
		</SelectPrimitive.Trigger>
	);
}

type SelectContentProps = React.ComponentProps<typeof SelectPrimitive.Popup> &
	Pick<
		React.ComponentProps<typeof SelectPrimitive.Positioner>,
		'align' | 'alignOffset' | 'side' | 'sideOffset'
	> & {
		position?: 'popper' | 'item-aligned';
	};

function SelectContent(props: SelectContentProps) {
	const popupProps = { ...props };
	delete popupProps.align;
	delete popupProps.alignOffset;
	delete popupProps.position;
	delete popupProps.side;
	delete popupProps.sideOffset;
	delete popupProps.className;
	const position = props.position ?? 'item-aligned';

	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Positioner
				align={props.align ?? 'center'}
				alignOffset={props.alignOffset}
				alignItemWithTrigger={position === 'item-aligned'}
				side={props.side}
				sideOffset={props.sideOffset ?? 4}
				className="isolate z-[60]"
			>
				<SelectPrimitive.Popup
					{...popupProps}
					data-slot="select-content"
					data-align-trigger={position === 'item-aligned'}
					className={cn(
						'relative max-h-(--available-height) min-w-[8rem] origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[starting-style]:animate-in data-[starting-style]:fade-in-0 data-[starting-style]:zoom-in-95 data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95',
						position === 'popper' &&
							'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
						props.className,
					)}
				>
					<SelectScrollUpButton />
					<SelectPrimitive.List
						className={cn(
							'p-1',
							position === 'popper' &&
								'h-(--anchor-height) w-full min-w-(--anchor-width) scroll-my-1',
						)}
					>
						{props.children}
					</SelectPrimitive.List>
					<SelectScrollDownButton />
				</SelectPrimitive.Popup>
			</SelectPrimitive.Positioner>
		</SelectPrimitive.Portal>
	);
}

function SelectLabel(
	props: React.ComponentProps<typeof SelectPrimitive.GroupLabel>,
) {
	return (
		<SelectPrimitive.GroupLabel
			data-slot="select-label"
			className={cn(
				'px-2 py-1.5 text-xs text-muted-foreground',
				props.className,
			)}
			{...props}
		/>
	);
}

function SelectItem(props: React.ComponentProps<typeof SelectPrimitive.Item>) {
	return (
		<SelectPrimitive.Item
			data-slot="select-item"
			className={cn(
				"relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground *:[span]:last:flex *:[span]:last:min-w-0 *:[span]:last:flex-1 *:[span]:last:overflow-hidden *:[span]:last:items-center *:[span]:last:gap-2",
				props.className,
			)}
			{...props}
		>
			<span
				data-slot="select-item-indicator"
				className="absolute right-2 flex size-3.5 items-center justify-center"
			>
				<SelectPrimitive.ItemIndicator>
					<CheckIcon className="size-4" />
				</SelectPrimitive.ItemIndicator>
			</span>
			<SelectPrimitive.ItemText>{props.children}</SelectPrimitive.ItemText>
		</SelectPrimitive.Item>
	);
}

function SelectSeparator(
	props: React.ComponentProps<typeof SelectPrimitive.Separator>,
) {
	return (
		<SelectPrimitive.Separator
			data-slot="select-separator"
			className={cn(
				'pointer-events-none -mx-1 my-1 h-px bg-border',
				props.className,
			)}
			{...props}
		/>
	);
}

function SelectScrollUpButton(
	props: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>,
) {
	return (
		<SelectPrimitive.ScrollUpArrow
			data-slot="select-scroll-up-button"
			className={cn(
				'flex cursor-default items-center justify-center py-1',
				props.className,
			)}
			{...props}
		>
			<ChevronUpIcon className="size-4" />
		</SelectPrimitive.ScrollUpArrow>
	);
}

function SelectScrollDownButton(
	props: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>,
) {
	return (
		<SelectPrimitive.ScrollDownArrow
			data-slot="select-scroll-down-button"
			className={cn(
				'flex cursor-default items-center justify-center py-1',
				props.className,
			)}
			{...props}
		>
			<ChevronDownIcon className="size-4" />
		</SelectPrimitive.ScrollDownArrow>
	);
}

export {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectScrollDownButton,
	SelectScrollUpButton,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
};
