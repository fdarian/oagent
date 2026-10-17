import { ORPCError } from '@orpc/client';
import { useForm, useStore } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
	CUSTOM_HARNESS_ID_PATTERN,
	type CustomHarness,
	harnessCatalogQueryOptions,
	INLINE_ACP_HARNESS_ID,
	invalidateCustomHarnesses,
	useRefreshHarnesses,
} from '@/lib/harnesses';
import { client } from '@/lib/orpc';

const ID_FIELD_ERROR_CODES: ReadonlyArray<string> = [
	'INVALID_ID',
	'RESERVED_ID',
	'ALREADY_EXISTS',
];

type ServerError = { field: 'id' | 'form'; message: string };

function toServerError(error: Error): ServerError {
	if (
		error instanceof ORPCError &&
		error.code === 'BAD_REQUEST' &&
		typeof error.data === 'object' &&
		error.data !== null &&
		'code' in error.data &&
		typeof error.data.code === 'string' &&
		ID_FIELD_ERROR_CODES.includes(error.data.code)
	) {
		return { field: 'id', message: error.message };
	}
	return { field: 'form', message: error.message };
}

function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 32)
		.replace(/-+$/, '');
}

function parseArgs(text: string): Array<string> {
	return text
		.split('\n')
		.map((line) => line.replace(/\r$/, ''))
		.filter((line) => line.trim() !== '');
}

type CustomHarnessFormProps = {
	/** Present when editing; the id is then immutable. */
	harness?: CustomHarness;
	onSaved: (harness: CustomHarness) => void;
};

export function CustomHarnessForm(props: CustomHarnessFormProps) {
	const queryClient = useQueryClient();
	const catalogQuery = useQuery(harnessCatalogQueryOptions());
	const refreshHarnesses = useRefreshHarnesses();
	const [serverError, setServerError] = useState<ServerError | undefined>();
	const idEditedByUser = useRef(false);
	const isEditing = props.harness !== undefined;

	const saveMutation = useMutation({
		mutationFn: (input: {
			id: string;
			name: string;
			binary: string;
			args: Array<string>;
		}) =>
			isEditing
				? client.customHarnesses.update(input)
				: client.customHarnesses.create(input),
		onSuccess: async (saved) => {
			await refreshHarnesses.mutateAsync();
			await invalidateCustomHarnesses(queryClient);
			props.onSaved(saved);
		},
		onError: (error: Error) => {
			setServerError(toServerError(error));
		},
	});

	const form = useForm({
		defaultValues: {
			name: props.harness?.name ?? '',
			id: props.harness?.id ?? '',
			binary: props.harness?.binary ?? '',
			args: props.harness?.args.join('\n') ?? '',
		},
		onSubmit: (submission) => {
			setServerError(undefined);
			saveMutation.mutate({
				id: submission.value.id,
				name: submission.value.name.trim(),
				binary: submission.value.binary.trim(),
				args: parseArgs(submission.value.args),
			});
		},
	});
	const canSubmit = useStore(form.store, (state) => state.canSubmit);
	const isSubmitting = useStore(form.store, (state) => state.isSubmitting);

	const takenIds = new Set([
		INLINE_ACP_HARNESS_ID,
		...(catalogQuery.data ?? []).map((entry) => entry.id),
	]);

	return (
		<form
			className="grid max-w-xl gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				form.handleSubmit();
			}}
		>
			<form.Field
				name="name"
				validators={{
					onChange: ({ value }) =>
						value.trim() === '' ? 'Name is required' : undefined,
				}}
			>
				{(field) => {
					const isInvalid =
						field.state.meta.isTouched && field.state.meta.errors.length > 0;
					return (
						<Field data-invalid={isInvalid}>
							<FieldLabel htmlFor="custom-harness-name">Name</FieldLabel>
							<Input
								id="custom-harness-name"
								value={field.state.value}
								placeholder="e.g. Gemini CLI"
								aria-invalid={isInvalid}
								onBlur={field.handleBlur}
								onChange={(event) => {
									field.handleChange(event.target.value);
									if (!isEditing && !idEditedByUser.current) {
										form.setFieldValue('id', slugify(event.target.value));
									}
								}}
							/>
							{isInvalid && <FieldError errors={field.state.meta.errors} />}
						</Field>
					);
				}}
			</form.Field>

			<form.Field
				name="id"
				validators={{
					onChange: ({ value }) => {
						if (isEditing) return undefined;
						if (!CUSTOM_HARNESS_ID_PATTERN.test(value))
							return 'Use 1-32 lowercase letters, digits or hyphens, starting with a letter';
						if (takenIds.has(value)) return `"${value}" is already taken`;
						return undefined;
					},
				}}
			>
				{(field) => {
					const serverIdError =
						serverError?.field === 'id' ? serverError.message : undefined;
					const errors = [
						...field.state.meta.errors,
						...(serverIdError === undefined ? [] : [serverIdError]),
					];
					const isInvalid =
						(field.state.meta.isTouched &&
							field.state.meta.errors.length > 0) ||
						serverIdError !== undefined;
					return (
						<Field data-invalid={isInvalid}>
							<FieldLabel htmlFor="custom-harness-id">ID</FieldLabel>
							<Input
								id="custom-harness-id"
								value={field.state.value}
								disabled={isEditing}
								placeholder="e.g. gemini"
								className="font-mono"
								aria-invalid={isInvalid}
								onBlur={field.handleBlur}
								onChange={(event) => {
									idEditedByUser.current = true;
									setServerError(undefined);
									field.handleChange(event.target.value);
								}}
							/>
							{isInvalid ? (
								<FieldError errors={errors} />
							) : isEditing ? (
								<FieldDescription>The ID cannot be changed.</FieldDescription>
							) : (
								<FieldDescription>
									Used as the model prefix, e.g.{' '}
									<code className="font-mono">
										{field.state.value === '' ? 'id' : field.state.value}
										:model-id
									</code>
								</FieldDescription>
							)}
						</Field>
					);
				}}
			</form.Field>

			<form.Field
				name="binary"
				validators={{
					onChange: ({ value }) =>
						value.trim() === '' ? 'Command is required' : undefined,
				}}
			>
				{(field) => {
					const isInvalid =
						field.state.meta.isTouched && field.state.meta.errors.length > 0;
					return (
						<Field data-invalid={isInvalid}>
							<FieldLabel htmlFor="custom-harness-binary">Command</FieldLabel>
							<Input
								id="custom-harness-binary"
								value={field.state.value}
								placeholder="gemini"
								className="font-mono"
								aria-invalid={isInvalid}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
							/>
							{isInvalid ? (
								<FieldError errors={field.state.meta.errors} />
							) : (
								<FieldDescription>
									Executable on PATH or an absolute path. It must speak ACP over
									stdio.
								</FieldDescription>
							)}
						</Field>
					);
				}}
			</form.Field>

			<form.Field name="args">
				{(field) => (
					<Field>
						<FieldLabel htmlFor="custom-harness-args">Arguments</FieldLabel>
						<Textarea
							id="custom-harness-args"
							value={field.state.value}
							placeholder={'--experimental-acp'}
							className="font-mono text-xs"
							onBlur={field.handleBlur}
							onChange={(event) => field.handleChange(event.target.value)}
						/>
						<FieldDescription>
							One argument per line. Spaces and quotes are kept literally.
						</FieldDescription>
					</Field>
				)}
			</form.Field>

			{serverError?.field === 'form' ? (
				<Alert variant="destructive">
					<AlertTitle>Could not save harness</AlertTitle>
					<AlertDescription>{serverError.message}</AlertDescription>
				</Alert>
			) : null}

			<div className="flex gap-2">
				<Button
					type="submit"
					disabled={!canSubmit || isSubmitting || saveMutation.isPending}
				>
					{saveMutation.isPending
						? 'Saving…'
						: isEditing
							? 'Save'
							: 'Add harness'}
				</Button>
			</div>
		</form>
	);
}
