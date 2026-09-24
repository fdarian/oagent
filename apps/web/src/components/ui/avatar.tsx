import { Avatar as AvatarPrimitive } from '@base-ui/react/avatar';
import type * as React from 'react';

import { cn } from '@/lib/utils';

type AvatarProps = React.ComponentProps<typeof AvatarPrimitive.Root> & {
	size?: 'default' | 'sm' | 'lg';
};

function Avatar(props: AvatarProps) {
	const primitiveProps = { ...props };
	delete primitiveProps.size;

	return (
		<AvatarPrimitive.Root
			data-slot="avatar"
			data-size={props.size ?? 'default'}
			className={cn(
				'group/avatar relative flex size-8 shrink-0 overflow-hidden rounded-full select-none data-[size=lg]:size-10 data-[size=sm]:size-6',
				props.className,
			)}
			{...primitiveProps}
		/>
	);
}

function AvatarImage(
	props: React.ComponentProps<typeof AvatarPrimitive.Image>,
) {
	return (
		<AvatarPrimitive.Image
			data-slot="avatar-image"
			className={cn('aspect-square size-full', props.className)}
			{...props}
		/>
	);
}

function AvatarFallback(
	props: React.ComponentProps<typeof AvatarPrimitive.Fallback>,
) {
	return (
		<AvatarPrimitive.Fallback
			data-slot="avatar-fallback"
			className={cn(
				'flex size-full items-center justify-center rounded-full bg-muted text-sm text-muted-foreground group-data-[size=sm]/avatar:text-xs',
				props.className,
			)}
			{...props}
		/>
	);
}

function AvatarBadge(props: React.ComponentProps<'span'>) {
	return (
		<span
			data-slot="avatar-badge"
			className={cn(
				'absolute right-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background select-none',
				'group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden',
				'group-data-[size=default]/avatar:size-2.5 group-data-[size=default]/avatar:[&>svg]:size-2',
				'group-data-[size=lg]/avatar:size-3 group-data-[size=lg]/avatar:[&>svg]:size-2',
				props.className,
			)}
			{...props}
		/>
	);
}

function AvatarGroup(props: React.ComponentProps<'div'>) {
	return (
		<div
			data-slot="avatar-group"
			className={cn(
				'group/avatar-group flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background',
				props.className,
			)}
			{...props}
		/>
	);
}

function AvatarGroupCount(props: React.ComponentProps<'div'>) {
	return (
		<div
			data-slot="avatar-group-count"
			className={cn(
				'relative flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm text-muted-foreground ring-2 ring-background group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-6 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3',
				props.className,
			)}
			{...props}
		/>
	);
}

export {
	Avatar,
	AvatarBadge,
	AvatarFallback,
	AvatarGroup,
	AvatarGroupCount,
	AvatarImage,
};
