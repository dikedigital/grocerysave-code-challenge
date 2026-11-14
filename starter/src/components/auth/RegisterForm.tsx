import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useAuth } from '../../contexts/AuthContext';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Input from '../ui/Input';

interface RegisterValues {
  displayName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

const RegisterForm: React.FC = () => {
  const { signUp } = useAuth();
  const location = useLocation();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    defaultValues: { displayName: '', email: '', password: '', confirmPassword: '' },
  });

  // Registering signs the user in; PublicOnlyRoute then redirects to the remembered page.
  const onSubmit = async ({ displayName, email, password }: RegisterValues) => {
    setSubmitError(null);
    try {
      await signUp(email, password, displayName);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Could not create the account.');
    }
  };

  return (
    <div className="bg-white p-6 sm:p-8 rounded-lg shadow-md">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Create your account</h2>

      {submitError && <Alert className="mb-4">{submitError}</Alert>}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <Input
          label="Name (optional)"
          type="text"
          autoComplete="name"
          placeholder="How should we call you?"
          error={errors.displayName?.message}
          {...register('displayName', { maxLength: { value: 80, message: 'Keep the name under 80 characters' } })}
        />
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          error={errors.email?.message}
          {...register('email', {
            required: 'Email is required',
            pattern: { value: EMAIL_PATTERN, message: 'Enter a valid email address' },
          })}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          helperText={`Use at least ${MIN_PASSWORD_LENGTH} characters.`}
          error={errors.password?.message}
          {...register('password', {
            required: 'Password is required',
            minLength: {
              value: MIN_PASSWORD_LENGTH,
              message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
            },
          })}
        />
        <Input
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          placeholder="Repeat your password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword', {
            required: 'Please confirm your password',
            validate: (value) => value === getValues('password') || 'Passwords do not match',
          })}
        />
        <Button type="submit" className="w-full" isLoading={isSubmitting}>
          {isSubmitting ? 'Creating account...' : 'Create account'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-600">
        Already have an account?{' '}
        <Link
          to="/login"
          state={location.state}
          className="font-medium text-green-600 hover:text-green-500 focus:outline-none focus-visible:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
};

export default RegisterForm;
