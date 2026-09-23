import type { ToolCallContent } from '@oagent/engine';
import { CodeBlock } from '@/components/ai-elements/code-block';
import { readToolStringProp } from '@/components/job-timeline-tool-helpers';
import { detectLanguage } from '@/lib/detect-language';

export type JobTimelineToolAttachment = {
	url?: string;
	mime?: string;
	filename?: string;
	type?: string;
};

export function toolContentKey(
	content: ToolCallContent,
	fallbackIndex: number,
): string {
	if (content.type === 'diff') return `diff-${content.path}`;
	if (content.type === 'terminal') return `terminal-${content.terminalId}`;
	return `content-${fallbackIndex}`;
}

export function readToolAttachments(
	rawOutput: unknown,
): JobTimelineToolAttachment[] {
	if (typeof rawOutput !== 'object' || rawOutput === null) return [];
	const attachments = (rawOutput as Record<string, unknown>).attachments;
	if (!Array.isArray(attachments)) return [];
	return attachments.flatMap((attachment) => {
		if (typeof attachment !== 'object' || attachment === null) return [];
		const item: JobTimelineToolAttachment = {
			url: readToolStringProp(attachment, 'url'),
			mime: readToolStringProp(attachment, 'mime'),
			filename: readToolStringProp(attachment, 'filename'),
			type: readToolStringProp(attachment, 'type'),
		};
		if (
			item.url === undefined &&
			item.mime === undefined &&
			item.filename === undefined &&
			item.type === undefined
		) {
			return [];
		}
		return [item];
	});
}

function mediaSource(
	mimeType: string,
	data: string,
	uri?: string | null,
): string {
	if (uri !== undefined && uri !== null && uri.length > 0) return uri;
	return `data:${mimeType};base64,${data}`;
}

function attachmentLabel(attachment: JobTimelineToolAttachment): string {
	if (attachment.filename !== undefined && attachment.filename.length > 0) {
		return attachment.filename;
	}
	if (attachment.mime !== undefined && attachment.mime.length > 0) {
		return attachment.mime;
	}
	if (attachment.type !== undefined && attachment.type.length > 0) {
		return attachment.type;
	}
	return 'Attachment';
}

export function JobTimelineToolAttachmentBlock(props: {
	attachment: JobTimelineToolAttachment;
}) {
	const attachment = props.attachment;
	const label = attachmentLabel(attachment);
	if (
		attachment.mime?.startsWith('image/') === true &&
		attachment.url !== undefined
	) {
		return (
			<figure className="space-y-1">
				<img
					alt={label}
					className="max-h-48 max-w-full rounded-md border object-contain"
					src={attachment.url}
				/>
				<figcaption className="text-xs text-muted-foreground">
					{label}
				</figcaption>
			</figure>
		);
	}
	if (
		attachment.mime?.startsWith('audio/') === true &&
		attachment.url !== undefined
	) {
		return (
			<figure className="space-y-1">
				{/* biome-ignore lint/a11y/useMediaCaption: ACP audio does not include caption metadata; the labelled controls and download fallback remain available. */}
				<audio
					aria-label={`Audio attachment: ${label}`}
					className="w-full"
					controls
					preload="metadata"
				>
					<source src={attachment.url} type={attachment.mime} />
				</audio>
				<div className="text-xs text-muted-foreground">
					<a
						className="underline underline-offset-2"
						download={attachment.filename}
						href={attachment.url}
						rel="noreferrer"
					>
						Download {label}
					</a>
				</div>
				<figcaption className="text-xs text-muted-foreground">
					{label}
				</figcaption>
			</figure>
		);
	}

	return (
		<div className="text-xs">
			{attachment.url !== undefined ? (
				<a
					className="underline underline-offset-2"
					download={attachment.filename}
					href={attachment.url}
					rel="noreferrer"
					target="_blank"
				>
					{label}
				</a>
			) : (
				<span>{label}</span>
			)}
		</div>
	);
}

function StandardContentBlock(props: {
	content: Extract<ToolCallContent, { type: 'content' }>['content'];
}) {
	const content = props.content;
	if (content.type === 'text') {
		return (
			<CodeBlock code={content.text} language={detectLanguage(content.text)} />
		);
	}
	if (content.type === 'image') {
		return (
			<div className="space-y-1">
				<img
					alt="Tool output"
					className="max-h-64 max-w-full rounded-md border object-contain"
					src={mediaSource(content.mimeType, content.data, content.uri)}
				/>
				<div className="text-xs text-muted-foreground">{content.mimeType}</div>
			</div>
		);
	}
	if (content.type === 'audio') {
		return (
			<JobTimelineToolAttachmentBlock
				attachment={{
					url: mediaSource(content.mimeType, content.data),
					mime: content.mimeType,
					type: 'Audio',
				}}
			/>
		);
	}
	if (content.type === 'resource_link') {
		return (
			<div className="text-xs">
				<a
					className="underline underline-offset-2"
					href={content.uri}
					rel="noreferrer"
					target="_blank"
				>
					{content.title ?? content.name}
				</a>
			</div>
		);
	}
	if ('text' in content.resource) {
		return (
			<pre className="m-0 whitespace-pre-wrap text-xs">
				{content.resource.text}
			</pre>
		);
	}
	const mimeType = content.resource.mimeType ?? 'application/octet-stream';
	return (
		<JobTimelineToolAttachmentBlock
			attachment={{
				url: mediaSource(mimeType, content.resource.blob),
				mime: mimeType,
				type: 'Resource',
			}}
		/>
	);
}

export function JobTimelineToolContentBlock(props: {
	content: ToolCallContent;
}) {
	const content = props.content;
	if (content.type === 'content') {
		return <StandardContentBlock content={content.content} />;
	}
	if (content.type === 'diff') {
		return (
			<div className="space-y-1">
				<div className="font-mono text-muted-foreground text-xs">
					{content.path}
				</div>
				{content.oldText !== undefined && content.oldText !== null && (
					<pre className="whitespace-pre-wrap text-destructive text-xs">
						{content.oldText}
					</pre>
				)}
				<pre className="whitespace-pre-wrap text-xs">{content.newText}</pre>
			</div>
		);
	}
	if (content.type === 'terminal') {
		return (
			<div className="text-xs text-muted-foreground">
				[terminal {content.terminalId}]
			</div>
		);
	}
	return null;
}
