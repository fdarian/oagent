import { memo, useLayoutEffect, useRef, useState } from 'react';
import { Message, MessageContent } from '@/components/ai-elements/message';
import type { TimelinePart } from '@/lib/event-adapter';
import { cn } from '@/lib/utils';

export type JobTimelineSteerProps = {
	part: Extract<TimelinePart, { kind: 'steer' }>;
};

export const JobTimelineSteer = memo(function JobTimelineSteer(
	props: JobTimelineSteerProps,
) {
	const [isExpanded, setIsExpanded] = useState(false);
	const [isTruncated, setIsTruncated] = useState(false);
	const textRef = useRef<HTMLParagraphElement>(null);
	const message = props.part.text;

	useLayoutEffect(() => {
		const text = textRef.current;
		if (text === null || isExpanded) return;

		const updateTruncation = () => {
			if (text.textContent !== message) return;
			setIsTruncated(text.scrollHeight > text.clientHeight + 1);
		};
		updateTruncation();

		const observer = new ResizeObserver(updateTruncation);
		observer.observe(text);
		return () => observer.disconnect();
	}, [isExpanded, message]);

	return (
		<Message from="user" aria-label="Steer message" className="pb-15">
			<MessageContent className="items-start text-left group-[.is-user]:bg-muted">
				<p
					ref={textRef}
					className={cn(
						'whitespace-pre-wrap break-words',
						!isExpanded && 'line-clamp-3',
					)}
				>
					{message}
				</p>
				{(isTruncated || isExpanded) && (
					<button
						type="button"
						className="text-muted-foreground text-xs underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
						aria-expanded={isExpanded}
						onClick={() => setIsExpanded((expanded) => !expanded)}
					>
						{isExpanded ? 'Show less' : 'Show more'}
					</button>
				)}
			</MessageContent>
		</Message>
	);
});
