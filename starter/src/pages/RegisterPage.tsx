import React from 'react';
import { Link } from 'react-router-dom';
import { ShoppingCart } from 'lucide-react';
import RegisterForm from '../components/auth/RegisterForm';

const RegisterPage: React.FC = () => (
  <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
    <div className="sm:mx-auto sm:w-full sm:max-w-md">
      <div className="flex justify-center">
        <Link to="/" className="flex items-center rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500">
          <ShoppingCart className="h-10 w-10 text-green-600" aria-hidden="true" />
          <span className="ml-2 text-2xl font-bold text-gray-900">GrocerySave</span>
        </Link>
      </div>
      <h1 className="mt-6 text-center text-3xl font-extrabold text-gray-900">Start saving on groceries</h1>
      <p className="mt-2 text-center text-sm text-gray-600">Create a free account to build and compare lists.</p>
    </div>

    <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
      <RegisterForm />
    </div>
  </div>
);

export default RegisterPage;
