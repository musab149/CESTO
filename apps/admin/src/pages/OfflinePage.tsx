import { useNavigate } from 'react-router-dom';
import { WifiOff, RefreshCw, Home } from 'lucide-react';
import ErrorPage from './ErrorPage';

export default function OfflinePage() {
  const navigate = useNavigate();
  return (
    <ErrorPage
      icon={WifiOff}
      accent="warning"
      badge="OFFLINE"
      title="No internet connection"
      body="We can't reach the API. Check your network and try again."
      hideBack
      actions={[
        { label: 'Try again', icon: RefreshCw, onClick: () => window.location.reload() },
        { label: 'Dashboard', icon: Home, variant: 'secondary', onClick: () => navigate('/') },
      ]}
    />
  );
}
