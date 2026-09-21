import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const variants = cva('flex items-center flex-wrap shrink-0', {
	variants: {
		size: {
			md: 'gap-2',
			sm: 'gap-1',
		},
	},
});

export function ActionRow({
	className,
	size,
	...props
}: React.ComponentProps<'div'> & VariantProps<typeof variants>) {
	return <div className={cn(variants({ size, className }))} {...props} />;
}
