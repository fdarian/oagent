import { useStore } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { FieldDescription, useAppForm, withForm } from '@/components/ui/form';
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

function validateDuplicateEnvironmentKeys(
	entries: ReadonlyArray<HarnessEnvEntry>,
): string | undefined {
	const keys = new Set<string>();
	for (const entry of entries) {
		if (keys.has(entry.key)) return 'Environment variable names must be unique';
		keys.add(entry.key);
	}
	return undefined;
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

const HarnessEnvFields = withForm({
	defaultValues: { env: [] as Array<HarnessEnvFormEntry> },
	render: (renderProps) => {
		const form = renderProps.form;
		return (
			<form.AppField
				name="env"
				mode="array"
				validators={{
					onChange: (change) => validateDuplicateEnvironmentKeys(change.value),
					onSubmit: (submission) =>
						validateDuplicateEnvironmentKeys(submission.value),
				}}
			>
				{(arrayField) => {
					const isInvalid =
						arrayField.state.meta.isTouched &&
						arrayField.state.meta.errors.length > 0;
					return (
						<arrayField.Field>
							<div className="grid gap-3">
								{arrayField.state.value.map((entry, index) => {
									const keyId = `${arrayField.name}-${index}-key`;
									const valueId = `${arrayField.name}-${index}-value`;
									return (
										<div
											className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start"
											key={entry.id}
										>
											<form.AppField
												name={`env[${index}].key`}
												validators={{
													onChange: (change) =>
														validateEnvironmentKey(change.value),
													onSubmit: (submission) =>
														validateEnvironmentKey(submission.value),
												}}
											>
												{(keyField) => {
													const keyIsInvalid =
														keyField.state.meta.isTouched &&
														!keyField.state.meta.isValid;
													return (
														<keyField.Field data-invalid={keyIsInvalid}>
															<keyField.FieldLabel htmlFor={keyId}>
																Name
															</keyField.FieldLabel>
															<Input
																id={keyId}
																name={keyField.name}
																value={keyField.state.value}
																onBlur={keyField.handleBlur}
																onChange={(event) =>
																	keyField.handleChange(event.target.value)
																}
																aria-invalid={keyIsInvalid}
																placeholder="API_KEY"
																autoComplete="off"
																className="font-mono text-xs"
															/>
															{keyIsInvalid ? <keyField.FieldError /> : null}
														</keyField.Field>
													);
												}}
											</form.AppField>

											<form.AppField name={`env[${index}].value`}>
												{(valueField) => (
													<valueField.Field>
														<valueField.FieldLabel htmlFor={valueId}>
															Value
														</valueField.FieldLabel>
														<Input
															id={valueId}
															name={valueField.name}
															value={valueField.state.value}
															onBlur={valueField.handleBlur}
															onChange={(event) =>
																valueField.handleChange(event.target.value)
															}
															placeholder="value"
															autoComplete="off"
															className="font-mono text-xs"
														/>
													</valueField.Field>
												)}
											</form.AppField>

											<Button
												type="button"
												variant="outline"
												className="sm:mt-6"
												onClick={() => arrayField.removeValue(index)}
											>
												Remove
											</Button>
										</div>
									);
								})}

								{isInvalid ? <arrayField.FieldError /> : null}
								<Button
									type="button"
									variant="outline"
									onClick={() =>
										arrayField.pushValue({
											id: crypto.randomUUID(),
											key: '',
											value: '',
										})
									}
								>
									Add variable
								</Button>
							</div>
						</arrayField.Field>
					);
				}}
			</form.AppField>
		);
	},
});

type HarnessEnvSectionProps = {
	backend: Backend;
};

export function HarnessEnvSection(props: HarnessEnvSectionProps) {
	const envQuery = useQuery({
		queryKey: queryKeys.harnessEnv(props.backend),
		queryFn: () => orpc.settings.getHarnessEnv({ backend: props.backend }),
	});

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
			) : envQuery.data === undefined ? (
				<p className="text-sm text-muted-foreground">
					Environment variables are unavailable.
				</p>
			) : (
				<HarnessEnvForm backend={props.backend} entries={envQuery.data.env} />
			)}
		</div>
	);
}

type HarnessEnvFormProps = {
	backend: Backend;
	entries: ReadonlyArray<HarnessEnvEntry>;
};

function HarnessEnvForm(props: HarnessEnvFormProps) {
	const queryClient = useQueryClient();
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
		defaultValues: { env: toFormEntries(props.entries) },
		onSubmit: (submission) => {
			saveMutation.mutate(submission.value.env);
		},
	});
	const canSubmit = useStore(form.store, (state) => state.canSubmit);
	const isSubmitting = useStore(form.store, (state) => state.isSubmitting);

	return (
		<form.AppForm>
			<form.Form className="grid gap-4">
				<HarnessEnvFields form={form} />

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
	);
}
