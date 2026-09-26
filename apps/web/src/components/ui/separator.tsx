'use client';

import { Separator as SeparatorPrimitive } from '@base-ui/react/separator';
import type * as React from 'react';

import { cn } from '@/lib/utils';

function Separator(props: React.ComponentProps<typeof SeparatorPrimitive>) {
	return (
		<SeparatorPrimitive
			data-slot="separator"
			orientation={props.orientation ?? 'horizontal'}
			className={cn(
				'shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
				props.className,
			)}
			{...props}
		/>
	);
}

export { Separator };
