import { PlainTextExtension } from '@lexical/plain-text';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalExtensionComposer } from '@lexical/react/LexicalExtensionComposer';
import {
	$getRoot,
	COMMAND_PRIORITY_HIGH,
	defineExtension,
	KEY_ENTER_COMMAND,
} from 'lexical';
import { CornerDownLeftIcon } from 'lucide-react';
import {
	type MutableRefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';

const sideChatComposerExtension = defineExtension({
	name: 'oagent/side-chat-composer',
	namespace: 'oagent-side-chat-composer',
	dependencies: [PlainTextExtension],
});

export type SideChatComposerProps = {
	disabled: boolean;
	onSubmit: (text: string) => Promise<void>;
	onError: (error: unknown) => void;
};

type ComposerControllerProps = SideChatComposerProps & {
	isComposing: MutableRefObject<boolean>;
};

function ComposerController(props: ComposerControllerProps) {
	const context = useLexicalComposerContext();
	const editor = context[0];
	const [hasText, setHasText] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const submit = useCallback(async () => {
		if (props.disabled || isSubmitting) return;
		const text = editor
			.getEditorState()
			.read(() => $getRoot().getTextContent());
		if (text.trim().length === 0) return;

		setIsSubmitting(true);
		try {
			await props.onSubmit(text);
			editor.update(() => {
				$getRoot().clear();
			});
		} catch (error) {
			props.onError(error);
		} finally {
			setIsSubmitting(false);
		}
	}, [editor, isSubmitting, props.disabled, props.onError, props.onSubmit]);

	useEffect(() => {
		return editor.registerUpdateListener((update) => {
			const text = update.editorState.read(() => $getRoot().getTextContent());
			setHasText(text.trim().length > 0);
		});
	}, [editor]);

	useEffect(() => {
		editor.setEditable(!props.disabled);
	}, [editor, props.disabled]);

	useEffect(
		() =>
			editor.registerCommand(
				KEY_ENTER_COMMAND,
				(event) => {
					if (
						event === null ||
						event.shiftKey ||
						event.isComposing ||
						props.isComposing.current
					) {
						return false;
					}
					event.preventDefault();
					void submit();
					return true;
				},
				COMMAND_PRIORITY_HIGH,
			),
		[editor, props.isComposing, submit],
	);

	return (
		<>
			{!hasText && (
				<span className="pointer-events-none absolute top-1 left-0 text-caption text-muted-foreground">
					Ask a quick question...
				</span>
			)}
			<button
				type="button"
				disabled={props.disabled || isSubmitting || !hasText}
				onClick={() => {
					void submit();
				}}
				className="absolute top-1/2 right-0 flex size-6 -translate-y-1/2 items-center justify-center border-0 bg-transparent p-0 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
				aria-label="Send side-chat message"
			>
				<CornerDownLeftIcon className="size-4" />
			</button>
		</>
	);
}

export function SideChatComposer(props: SideChatComposerProps) {
	const isComposing = useRef(false);
	const contentEditable = useMemo(
		() => (
			<ContentEditable
				role="textbox"
				aria-multiline="true"
				aria-label="Side-chat message"
				aria-placeholder="Ask a quick question..."
				className="min-h-8 min-w-0 flex-1 whitespace-pre-wrap break-words py-1 pr-8 text-caption font-light text-foreground outline-none"
				onCompositionStart={() => {
					isComposing.current = true;
				}}
				onCompositionEnd={() => {
					isComposing.current = false;
				}}
			/>
		),
		[],
	);

	return (
		<div className="relative flex min-h-8 items-center gap-10">
			<LexicalExtensionComposer
				extension={sideChatComposerExtension}
				contentEditable={contentEditable}
			>
				<ComposerController
					disabled={props.disabled}
					onSubmit={props.onSubmit}
					onError={props.onError}
					isComposing={isComposing}
				/>
			</LexicalExtensionComposer>
		</div>
	);
}
