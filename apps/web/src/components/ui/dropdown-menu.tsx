'use client';

import { Menu as DropdownMenuPrimitive } from '@base-ui/react/menu';
import { CheckIcon, ChevronRightIcon, CircleIcon } from 'lucide-react';
import type * as React from 'react';
import { cn } from '@/lib/utils';

function DropdownMenu(
	props: React.ComponentProps<typeof DropdownMenuPrimitive.Root>,
) {
	return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuPortal(
	props: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>,
) {
	return (
		<DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
	);
}

function DropdownMenuTrigger(
	props: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>,
) {
	return (
		<DropdownMenuPrimitive.Trigger
			data-slot="dropdown-menu-trigger"
			{...props}
		/>
	);
}

type DropdownMenuPositioningProps = Pick<
	React.ComponentProps<typeof DropdownMenuPrimitive.Positioner>,
	'align' | 'alignOffset' | 'side' | 'sideOffset'
>;

type DropdownMenuContentProps = React.ComponentProps<
	typeof DropdownMenuPrimitive.Popup
> &
	DropdownMenuPositioningProps;

function DropdownMenuContent(props: DropdownMenuContentProps) {
	const popupProps = { ...props };
	delete popupProps.align;
	delete popupProps.alignOffset;
	delete popupProps.side;
	delete popupProps.sideOffset;

	return (
		<DropdownMenuPrimitive.Portal>
			<DropdownMenuPrimitive.Positioner
				align={props.align}
				alignOffset={props.alignOffset}
				side={props.side}
				sideOffset={props.sideOffset ?? 4}
				className="z-50"
			>
				<DropdownMenuPrimitive.Popup
					data-slot="dropdown-menu-content"
					className={cn(
						'max-h-(--available-height) min-w-[8rem] origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[starting-style]:animate-in data-[starting-style]:fade-in-0 data-[starting-style]:zoom-in-95 data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95',
						props.className,
					)}
					{...popupProps}
				/>
			</DropdownMenuPrimitive.Positioner>
		</DropdownMenuPrimitive.Portal>
	);
}

function DropdownMenuGroup(
	props: React.ComponentProps<typeof DropdownMenuPrimitive.Group>,
) {
	return (
		<DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
	);
}

type DropdownMenuItemProps = React.ComponentProps<
	typeof DropdownMenuPrimitive.Item
> & {
	inset?: boolean;
	variant?: 'default' | 'destructive';
};

function DropdownMenuItem(props: DropdownMenuItemProps) {
	const itemProps = { ...props };
	delete itemProps.inset;
	delete itemProps.variant;

	return (
		<DropdownMenuPrimitive.Item
			{...itemProps}
			data-slot="dropdown-menu-item"
			data-inset={props.inset}
			data-variant={props.variant ?? 'default'}
			className={cn(
				"relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 data-[variant=destructive]:text-destructive data-[variant=destructive]:data-highlighted:bg-destructive/10 data-[variant=destructive]:data-highlighted:text-destructive dark:data-[variant=destructive]:data-highlighted:bg-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground data-[variant=destructive]:*:[svg]:text-destructive!",
				props.className,
			)}
		/>
	);
}

function DropdownMenuCheckboxItem(
	props: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>,
) {
	return (
		<DropdownMenuPrimitive.CheckboxItem
			data-slot="dropdown-menu-checkbox-item"
			className={cn(
				"relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				props.className,
			)}
			{...props}
		>
			<DropdownMenuPrimitive.CheckboxItemIndicator
				render={
					<span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center" />
				}
			>
				<CheckIcon className="size-4" />
			</DropdownMenuPrimitive.CheckboxItemIndicator>
			{props.children}
		</DropdownMenuPrimitive.CheckboxItem>
	);
}

function DropdownMenuRadioGroup(
	props: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>,
) {
	return (
		<DropdownMenuPrimitive.RadioGroup
			data-slot="dropdown-menu-radio-group"
			{...props}
		/>
	);
}

function DropdownMenuRadioItem(
	props: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>,
) {
	return (
		<DropdownMenuPrimitive.RadioItem
			data-slot="dropdown-menu-radio-item"
			className={cn(
				"relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				props.className,
			)}
			{...props}
		>
			<DropdownMenuPrimitive.RadioItemIndicator
				render={
					<span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center" />
				}
			>
				<CircleIcon className="size-2 fill-current" />
			</DropdownMenuPrimitive.RadioItemIndicator>
			{props.children}
		</DropdownMenuPrimitive.RadioItem>
	);
}

type DropdownMenuLabelProps = React.ComponentProps<
	typeof DropdownMenuPrimitive.GroupLabel
> & {
	inset?: boolean;
};

function DropdownMenuLabel(props: DropdownMenuLabelProps) {
	const labelProps = { ...props };
	delete labelProps.inset;

	return (
		<DropdownMenuPrimitive.GroupLabel
			data-slot="dropdown-menu-label"
			data-inset={props.inset}
			className={cn(
				'px-2 py-1.5 text-sm font-medium data-[inset]:pl-8',
				props.className,
			)}
			{...labelProps}
		/>
	);
}

function DropdownMenuSeparator(
	props: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>,
) {
	return (
		<DropdownMenuPrimitive.Separator
			data-slot="dropdown-menu-separator"
			className={cn('-mx-1 my-1 h-px bg-border', props.className)}
			{...props}
		/>
	);
}

function DropdownMenuShortcut(props: React.ComponentProps<'span'>) {
	return (
		<span
			data-slot="dropdown-menu-shortcut"
			className={cn(
				'ml-auto text-xs tracking-widest text-muted-foreground',
				props.className,
			)}
			{...props}
		/>
	);
}

function DropdownMenuSub(
	props: React.ComponentProps<typeof DropdownMenuPrimitive.SubmenuRoot>,
) {
	return (
		<DropdownMenuPrimitive.SubmenuRoot
			data-slot="dropdown-menu-sub"
			{...props}
		/>
	);
}

type DropdownMenuSubTriggerProps = React.ComponentProps<
	typeof DropdownMenuPrimitive.SubmenuTrigger
> & {
	inset?: boolean;
};

function DropdownMenuSubTrigger(props: DropdownMenuSubTriggerProps) {
	const triggerProps = { ...props };
	delete triggerProps.inset;

	return (
		<DropdownMenuPrimitive.SubmenuTrigger
			data-slot="dropdown-menu-sub-trigger"
			data-inset={props.inset}
			className={cn(
				"flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-[inset]:pl-8 data-open:bg-accent data-open:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
				props.className,
			)}
			{...triggerProps}
		>
			{props.children}
			<ChevronRightIcon className="ml-auto size-4" />
		</DropdownMenuPrimitive.SubmenuTrigger>
	);
}

type DropdownMenuSubContentProps = React.ComponentProps<
	typeof DropdownMenuPrimitive.Popup
> &
	DropdownMenuPositioningProps;

function DropdownMenuSubContent(props: DropdownMenuSubContentProps) {
	const popupProps = { ...props };
	delete popupProps.align;
	delete popupProps.alignOffset;
	delete popupProps.side;
	delete popupProps.sideOffset;

	return (
		<DropdownMenuPrimitive.Portal>
			<DropdownMenuPrimitive.Positioner
				align={props.align}
				alignOffset={props.alignOffset}
				side={props.side ?? 'right'}
				sideOffset={props.sideOffset}
				className="z-50"
			>
				<DropdownMenuPrimitive.Popup
					data-slot="dropdown-menu-sub-content"
					className={cn(
						'min-w-[8rem] origin-(--transform-origin) overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[starting-style]:animate-in data-[starting-style]:fade-in-0 data-[starting-style]:zoom-in-95 data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95',
						props.className,
					)}
					{...popupProps}
				/>
			</DropdownMenuPrimitive.Positioner>
		</DropdownMenuPrimitive.Portal>
	);
}

export {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuPortal,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
};
