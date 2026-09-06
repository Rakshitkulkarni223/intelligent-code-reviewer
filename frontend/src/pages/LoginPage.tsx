import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../services/auth.tsx';

export default function LoginPage() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

  if (user) return <Navigate to="/" replace />;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    login(email);
    const from = (location.state as { from?: string })?.from ?? '/';
    navigate(from, { replace: true });
  };

  return (
    <div className="login-shell">
      <form className="card login-card" onSubmit={handleSubmit}>
        <div className="login-title">Code Reviewer</div>
        <div className="login-subtitle">Sign in to get 24/7 AI feedback on your code.</div>
        <label className="field-label" htmlFor="email">Email</label>
        <input
          id="email"
          className="text-input"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? 'email-error' : undefined}
          required
        />
        {error && <p id="email-error" role="alert" style={{ color: 'var(--danger)', marginTop: -10, fontSize: 13 }}>{error}</p>}
        <button className="btn btn-primary" type="submit" style={{ width: '100%', justifyContent: 'center' }}>
          Continue
        </button>
      </form>
    </div>
  );
}
