'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { XIcon } from 'lucide-react';
import type * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
	return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger(
	props: React.ComponentProps<typeof DialogPrimitive.Trigger>,
) {
	return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal(
	props: React.ComponentProps<typeof DialogPrimitive.Portal>,
) {
	return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose(
	props: React.ComponentProps<typeof DialogPrimitive.Close>,
) {
	return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay(
	props: React.ComponentProps<typeof DialogPrimitive.Backdrop>,
) {
	const backdropProps = { ...props };
	delete backdropProps.className;

	return (
		<DialogPrimitive.Backdrop
			{...backdropProps}
			data-slot="dialog-overlay"
			className={cn(
				'fixed inset-0 z-40 bg-black/50 data-[starting-style]:animate-in data-[starting-style]:fade-in-0 data-[ending-style]:animate-out data-[ending-style]:fade-out-0',
				props.className,
			)}
		/>
	);
}

type DialogContentProps = React.ComponentProps<typeof DialogPrimitive.Popup> & {
	showCloseButton?: boolean;
};

function DialogContent(props: DialogContentProps) {
	const popupProps = { ...props };
	delete popupProps.showCloseButton;
	delete popupProps.className;
	return (
		<DialogPortal data-slot="dialog-portal">
			<DialogOverlay />
			<DialogPrimitive.Popup
				{...popupProps}
				data-slot="dialog-content"
				className={cn(
					'fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 outline-none data-[starting-style]:animate-in data-[starting-style]:fade-in-0 data-[starting-style]:zoom-in-95 data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95 sm:max-w-lg',
					props.className,
				)}
			>
				{props.children}
				{props.showCloseButton !== false && (
					<DialogPrimitive.Close
						data-slot="dialog-close"
						render={
							<button
								type="button"
								className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-open:bg-accent data-open:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
							/>
						}
					>
						<XIcon />
						<span className="sr-only">Close</span>
					</DialogPrimitive.Close>
				)}
			</DialogPrimitive.Popup>
		</DialogPortal>
	);
}

function DialogHeader(props: React.ComponentProps<'div'>) {
	return (
		<div
			data-slot="dialog-header"
			className={cn(
				'flex flex-col gap-2 text-center sm:text-left',
				props.className,
			)}
			{...props}
		/>
	);
}

type DialogFooterProps = React.ComponentProps<'div'> & {
	showCloseButton?: boolean;
};

function DialogFooter(props: DialogFooterProps) {
	return (
		<div
			data-slot="dialog-footer"
			className={cn(
				'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
				props.className,
			)}
			{...props}
		>
			{props.children}
			{props.showCloseButton && (
				<DialogPrimitive.Close render={<Button variant="outline" />}>
					Close
				</DialogPrimitive.Close>
			)}
		</div>
	);
}

function DialogTitle(
	props: React.ComponentProps<typeof DialogPrimitive.Title>,
) {
	return (
		<DialogPrimitive.Title
			data-slot="dialog-title"
			className={cn('text-lg leading-none font-semibold', props.className)}
			{...props}
		/>
	);
}

function DialogDescription(
	props: React.ComponentProps<typeof DialogPrimitive.Description>,
) {
	return (
		<DialogPrimitive.Description
			data-slot="dialog-description"
			className={cn('text-sm text-muted-foreground', props.className)}
			{...props}
		/>
	);
}

export {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogOverlay,
	DialogPortal,
	DialogTitle,
	DialogTrigger,
};
