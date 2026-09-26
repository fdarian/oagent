import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

const buttonGroupVariants = cva(
	"flex w-fit items-stretch has-[>[data-slot=button-group]]:gap-2 [&>*]:focus-visible:relative [&>*]:focus-visible:z-10 has-[select[aria-hidden=true]:last-child]:[&>[data-slot=select-trigger]:last-of-type]:rounded-r-md [&>[data-slot=select-trigger]:not([class*='w-'])]:w-fit [&>input]:flex-1",
	{
		variants: {
			orientation: {
				horizontal:
					'[&>*:not(:first-child)]:rounded-l-none [&>*:not(:first-child)]:border-l-0 [&>*:not(:last-child)]:rounded-r-none',
				vertical:
					'flex-col [&>*:not(:first-child)]:rounded-t-none [&>*:not(:first-child)]:border-t-0 [&>*:not(:last-child)]:rounded-b-none',
			},
		},
		defaultVariants: {
			orientation: 'horizontal',
		},
	},
);

function ButtonGroup(
	props: React.ComponentProps<'div'> & VariantProps<typeof buttonGroupVariants>,
) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: A fieldset would change form layout and default styling.
		<div
			role="group"
			data-slot="button-group"
			data-orientation={props.orientation}
			className={cn(
				buttonGroupVariants({ orientation: props.orientation }),
				props.className,
			)}
			{...props}
		/>
	);
}

type ButtonGroupTextProps = React.ComponentProps<'div'> & {
	render?: React.ReactElement;
};

function ButtonGroupText(props: ButtonGroupTextProps) {
	const renderProps = { ...props };
	delete renderProps.className;
	delete renderProps.render;

	return useRender({
		defaultTagName: 'div',
		render: props.render,
		props: {
			...renderProps,
			children: props.children,
			className: cn(
				'flex items-center gap-2 rounded-md border bg-muted px-4 text-sm font-medium shadow-xs [&_svg]:pointer-events-none [&_svg:not([class*="size-"])]:size-4',
				props.className,
			),
		},
	});
}

function ButtonGroupSeparator(props: React.ComponentProps<typeof Separator>) {
	return (
		<Separator
			data-slot="button-group-separator"
			orientation={props.orientation ?? 'vertical'}
			className={cn(
				'relative m-0! self-stretch bg-input data-[orientation=vertical]:h-auto',
				props.className,
			)}
			{...props}
		/>
	);
}

export {
	ButtonGroup,
	ButtonGroupSeparator,
	ButtonGroupText,
	buttonGroupVariants,
};
