import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from '@/components/Layout';
import { Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Leads from '@/pages/Leads';
import LeadDetail from '@/pages/LeadDetail';
import Customers from '@/pages/Customers';
import CustomerDetail from '@/pages/CustomerDetail';
import Conversations from '@/pages/Conversations';
import ConversationDetail from '@/pages/ConversationDetail';
import BotMenu from '@/pages/BotMenu';
import Simulator from '@/pages/Simulator';
import Settings from '@/pages/Settings';
import WhatsAppSettings from '@/pages/WhatsAppSettings';

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <Spinner label="Signing you in…" />;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/leads" element={<Leads />} />
        <Route path="/leads/:id" element={<LeadDetail />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/customers/:id" element={<CustomerDetail />} />
        <Route path="/conversations" element={<Conversations />} />
        <Route path="/conversations/:id" element={<ConversationDetail />} />
        <Route path="/bot" element={<BotMenu />} />
        <Route path="/simulator" element={<Simulator />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/whatsapp" element={<WhatsAppSettings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
