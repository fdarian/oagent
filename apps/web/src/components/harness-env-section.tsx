import { useStore } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from '@/components/ui/field';
import { useAppForm } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import type { Backend } from '@/lib/harnesses';
import { orpc } from '@/lib/orpc';
import { queryKeys } from '@/lib/query-keys';

type HarnessEnvEntry = {
	key: string;
	value: string;
};

type HarnessEnvFormEntry = HarnessEnvEntry & {
	id: string;
};

const environmentKeyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

function validateEnvironmentKey(value: string): string | undefined {
	if (value.trim() === '') return 'Environment variable name is required';
	if (!environmentKeyPattern.test(value)) {
		return 'Use letters, numbers, and underscores; the first character cannot be a number';
	}
	return undefined;
}

function validateEnvironmentEntries(
	entries: ReadonlyArray<HarnessEnvEntry>,
): string | undefined {
	const keys = new Set<string>();
	for (const entry of entries) {
		const keyError = validateEnvironmentKey(entry.key);
		if (keyError !== undefined) return keyError;
		if (keys.has(entry.key)) return 'Environment variable names must be unique';
		keys.add(entry.key);
	}
	return undefined;
}

function fieldErrors(errors: ReadonlyArray<unknown>) {
	return errors.map((error) => ({
		message: typeof error === 'string' ? error : String(error),
	}));
}

function toFormEntries(
	entries: ReadonlyArray<HarnessEnvEntry>,
): Array<HarnessEnvFormEntry> {
	return entries.map((entry) => ({
		id: crypto.randomUUID(),
		key: entry.key,
		value: entry.value,
	}));
}

type HarnessEnvSectionProps = {
	backend: Backend;
};

export function HarnessEnvSection(props: HarnessEnvSectionProps) {
	const queryClient = useQueryClient();
	const envQuery = useQuery({
		queryKey: queryKeys.harnessEnv(props.backend),
		queryFn: () => orpc.settings.getHarnessEnv({ backend: props.backend }),
	});
	const saveMutation = useMutation({
		mutationFn: (env: ReadonlyArray<HarnessEnvFormEntry>) =>
			orpc.settings.setHarnessEnv({
				backend: props.backend,
				env: env.map((entry) => ({
					key: entry.key,
					value: entry.value,
				})),
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.harnessEnv(props.backend),
			});
		},
	});
	const form = useAppForm({
		defaultValues: { env: [] as Array<HarnessEnvFormEntry> },
		validators: {
			onSubmit: ({ value }) => validateEnvironmentEntries(value.env),
		},
		onSubmit: ({ value }) => {
			saveMutation.mutate(value.env);
		},
	});
	const canSubmit = useStore(form.store, (state) => state.canSubmit);
	const isSubmitting = useStore(form.store, (state) => state.isSubmitting);

	useEffect(() => {
		if (envQuery.data === undefined) return;
		form.reset({ env: toFormEntries(envQuery.data.env) });
	}, [envQuery.data, form]);

	return (
		<div className="grid max-w-xl gap-4 border-t border-border pt-8">
			<div>
				<h2 className="text-base font-medium text-foreground">
					Environment variables
				</h2>
				<FieldDescription className="mt-1">
					Variables are passed to newly started {props.backend} sessions.
					Existing sessions keep their current environment.
				</FieldDescription>
			</div>

			{envQuery.isLoading ? (
				<p className="text-sm text-muted-foreground">
					Loading environment variables…
				</p>
			) : envQuery.isError ? (
				<p className="text-sm text-destructive">
					Failed to load environment variables: {envQuery.error.message}
				</p>
			) : (
				<form.AppForm>
					<form.Form className="grid gap-4">
						<form.Field
							name="env"
							mode="array"
							validators={{
								onChange: ({ value }) => validateEnvironmentEntries(value),
							}}
						>
							{(field) => {
								const isInvalid =
									field.state.meta.isTouched &&
									field.state.meta.errors.length > 0;
								return (
									<div className="grid gap-3" data-invalid={isInvalid}>
										{field.state.value.map((entry, index) => {
											const keyError = validateEnvironmentKey(entry.key);
											const keyId = `${field.name}-${index}-key`;
											const valueId = `${field.name}-${index}-value`;
											return (
												<div
													className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start"
													key={entry.id}
												>
													<Field data-invalid={keyError !== undefined}>
														<FieldLabel htmlFor={keyId}>Name</FieldLabel>
														<Input
															id={keyId}
															name={`${field.name}[${index}].key`}
															value={entry.key}
															onBlur={field.handleBlur}
															onChange={(event) => {
																const next = [...field.state.value];
																const current = next[index];
																if (current === undefined) return;
																next[index] = {
																	id: current.id,
																	key: event.target.value,
																	value: current.value,
																};
																field.handleChange(next);
															}}
															aria-invalid={keyError !== undefined}
															placeholder="API_KEY"
															autoComplete="off"
															className="font-mono text-xs"
														/>
														{keyError !== undefined ? (
															<FieldError>{keyError}</FieldError>
														) : null}
													</Field>
													<Field>
														<FieldLabel htmlFor={valueId}>Value</FieldLabel>
														<Input
															id={valueId}
															name={`${field.name}[${index}].value`}
															value={entry.value}
															onChange={(event) => {
																const next = [...field.state.value];
																const current = next[index];
																if (current === undefined) return;
																next[index] = {
																	id: current.id,
																	key: current.key,
																	value: event.target.value,
																};
																field.handleChange(next);
															}}
															placeholder="value"
															autoComplete="off"
															className="font-mono text-xs"
														/>
													</Field>
													<Button
														type="button"
														variant="outline"
														className="sm:mt-6"
														onClick={() => field.removeValue(index)}
													>
														Remove
													</Button>
												</div>
											);
										})}

										{isInvalid ? (
											<FieldError
												errors={fieldErrors(field.state.meta.errors)}
											/>
										) : null}
										<Button
											type="button"
											variant="outline"
											onClick={() =>
												field.pushValue({
													id: crypto.randomUUID(),
													key: '',
													value: '',
												})
											}
										>
											Add variable
										</Button>
									</div>
								);
							}}
						</form.Field>

						<div className="flex items-center gap-2">
							<Button
								type="submit"
								disabled={!canSubmit || isSubmitting || saveMutation.isPending}
							>
								{saveMutation.isPending ? 'Saving…' : 'Save'}
							</Button>
							{saveMutation.isError ? (
								<p className="text-sm text-destructive">
									{saveMutation.error.message}
								</p>
							) : null}
						</div>
					</form.Form>
				</form.AppForm>
			)}
		</div>
	);
}
