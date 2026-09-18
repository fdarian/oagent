import {
	createFormHook,
	createFormHookContexts,
	useStore,
} from '@tanstack/react-form';
import type * as React from 'react';
import {
	Field as ShadcnField,
	FieldDescription as ShadcnFieldDescription,
	FieldError as ShadcnFieldError,
	FieldLabel as ShadcnFieldLabel,
} from '@/components/ui/field';

const formContexts = createFormHookContexts();
const fieldContext = formContexts.fieldContext;
const formContext = formContexts.formContext;
const useFieldContext = formContexts.useFieldContext;
const useFormContext = formContexts.useFormContext;

function Form(props: React.ComponentProps<'form'>) {
	const form = useFormContext();
	return (
		<form
			{...props}
			onSubmit={(event) => {
				event.preventDefault();
				form.handleSubmit();
			}}
		/>
	);
}

function Field(props: React.ComponentProps<typeof ShadcnField>) {
	const field = useFieldContext<unknown>();
	const isInvalid = useStore(
		field.store,
		(state) => state.meta.isTouched && !state.meta.isValid,
	);
	return <ShadcnField {...props} data-invalid={isInvalid} />;
}

function FieldLabel(props: React.ComponentProps<typeof ShadcnFieldLabel>) {
	const field = useFieldContext<unknown>();
	return <ShadcnFieldLabel {...props} htmlFor={props.htmlFor ?? field.name} />;
}

function FieldDescription(
	props: React.ComponentProps<typeof ShadcnFieldDescription>,
) {
	return <ShadcnFieldDescription {...props} />;
}

function FieldError(props: React.ComponentProps<typeof ShadcnFieldError>) {
	const field = useFieldContext<unknown>();
	const fieldErrors = useStore(field.store, (state) => state.meta.errors);
	const errors =
		props.errors ??
		fieldErrors.map((error) => ({
			message: typeof error === 'string' ? error : String(error),
		}));
	return <ShadcnFieldError {...props} errors={errors} />;
}

const formHook = createFormHook({
	fieldComponents: {
		Field,
		FieldLabel,
		FieldDescription,
		FieldError,
	},
	formComponents: { Form },
	fieldContext,
	formContext,
});

export const useAppForm = formHook.useAppForm;
export const withForm = formHook.withForm;
export { Field, FieldDescription, FieldError, FieldLabel, Form };
