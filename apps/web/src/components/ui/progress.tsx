'use client';

import { Progress as ProgressPrimitive } from '@base-ui/react/progress';
import type * as React from 'react';

import { cn } from '@/lib/utils';

type ProgressProps = Omit<
	React.ComponentProps<typeof ProgressPrimitive.Root>,
	'value'
> & {
	value?: number | null;
};

function Progress(props: ProgressProps) {
	const progressValue = props.value === undefined ? null : props.value;
	const rootProps = { ...props };
	delete rootProps.value;

	return (
		<ProgressPrimitive.Root
			data-slot="progress"
			value={progressValue}
			className={cn(
				'relative h-2 w-full overflow-hidden rounded-full bg-primary/20',
				props.className,
			)}
			{...rootProps}
		>
			<ProgressPrimitive.Track className="size-full">
				<ProgressPrimitive.Indicator
					data-slot="progress-indicator"
					className="h-full w-full flex-1 bg-primary transition-all"
					style={{
						transform:
							progressValue === null
								? undefined
								: `translateX(-${100 - progressValue}%)`,
					}}
				/>
			</ProgressPrimitive.Track>
		</ProgressPrimitive.Root>
	);
}

export { Progress };
