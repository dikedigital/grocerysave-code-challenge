import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useAuth } from '../../contexts/AuthContext';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Input from '../ui/Input';
import type { FromState } from './redirect';

interface LoginValues {
  email: string;
  password: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const LoginForm: React.FC = () => {
  const { signIn } = useAuth();
  const location = useLocation();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ defaultValues: { email: '', password: '' } });

  // Signing in updates the auth state; PublicOnlyRoute then redirects to the remembered page.
  const onSubmit = async ({ email, password }: LoginValues) => {
    setSubmitError(null);
    try {
      await signIn(email, password);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Could not sign in.');
    }
  };

  const from = (location.state as FromState | null)?.from;

  return (
    <div className="bg-white p-6 sm:p-8 rounded-lg shadow-md">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Sign in</h2>

      {from && !submitError && (
        <Alert variant="info" className="mb-4">
          Please sign in to continue.
        </Alert>
      )}
      {submitError && <Alert className="mb-4">{submitError}</Alert>}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
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
          autoComplete="current-password"
          placeholder="Your password"
          error={errors.password?.message}
          {...register('password', { required: 'Password is required' })}
        />
        <Button type="submit" className="w-full" isLoading={isSubmitting}>
          {isSubmitting ? 'Signing in...' : 'Sign in'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-600">
        New to GrocerySave?{' '}
        <Link
          to="/register"
          state={location.state}
          className="font-medium text-green-600 hover:text-green-500 focus:outline-none focus-visible:underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
};

export default LoginForm;
