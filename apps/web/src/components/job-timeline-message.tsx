import {
	Message,
	MessageContent,
	MessageResponse,
} from '@/components/ai-elements/message';
import type { TimelinePart } from '@/lib/event-adapter';

export type JobTimelineMessageProps = {
	part: Extract<TimelinePart, { kind: 'text' }>;
};

export function JobTimelineMessage({ part }: JobTimelineMessageProps) {
	return (
		<Message from="assistant">
			<MessageContent>
				<MessageResponse>{part.text}</MessageResponse>
			</MessageContent>
		</Message>
	);
}
