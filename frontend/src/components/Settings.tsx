import { useState, useEffect } from 'react';
import { Save, Mail, Inbox } from 'lucide-react';
import { getSetting, upsertSetting } from '../api/settings';

export default function Settings() {
  // Stan dla SMTP (Wysyłka)
  const [server, setServer] = useState('');
  const [port, setPort] = useState('587');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');

  // Stan dla IMAP (Odbiór)
  const [imapServer, setImapServer] = useState('');
  const [imapPort, setImapPort] = useState('993');
  const [imapLogin, setImapLogin] = useState('');
  const [imapPassword, setImapPassword] = useState('');

  const [status, setStatus] = useState({ type: '', message: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      getSetting('smtp_profile'),
      getSetting('imap_profile')
    ]).then(([smtpData, imapData]) => {
      if (smtpData && smtpData.value) {
        setServer(smtpData.value.server || '');
        setPort(smtpData.value.port?.toString() || '587');
        setLogin(smtpData.value.login || '');
        setPassword(smtpData.value.password || '');
      }
      if (imapData && imapData.value) {
        setImapServer(imapData.value.server || '');
        setImapPort(imapData.value.port?.toString() || '993');
        setImapLogin(imapData.value.login || '');
        setImapPassword(imapData.value.password || '');
      }
    }).catch(() => {
      console.log('Brak zapisanych ustawień poczty (lub błąd połączenia).');
    });
  }, []);

  const handleSaveSMTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus({ type: '', message: '' });

    try {
      await upsertSetting('smtp_profile', {
        server,
        port: parseInt(port, 10),
        login,
        password,
      });
      setStatus({ type: 'success', message: 'Ustawienia SMTP zapisano pomyślnie!' });
    } catch (error) {
      console.error(error);
      setStatus({ type: 'error', message: 'Wystąpił błąd podczas zapisywania SMTP.' });
    } finally {
      setLoading(false);
      setTimeout(() => setStatus({ type: '', message: '' }), 5000);
    }
  };

  const handleSaveIMAP = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus({ type: '', message: '' });

    try {
      await upsertSetting('imap_profile', {
        server: imapServer,
        port: parseInt(imapPort, 10),
        login: imapLogin,
        password: imapPassword,
      });
      setStatus({ type: 'success', message: 'Ustawienia IMAP zapisano pomyślnie!' });
    } catch (error) {
      console.error(error);
      setStatus({ type: 'error', message: 'Wystąpił błąd podczas zapisywania IMAP.' });
    } finally {
      setLoading(false);
      setTimeout(() => setStatus({ type: '', message: '' }), 5000);
    }
  };

  return (
    <div className="flex-1 bg-muted/30 overflow-auto">
      <header className="bg-white border-b border-border px-8 py-6">
        <h1 className="text-2xl font-semibold text-foreground">Ustawienia Globalne</h1>
        <p className="text-muted-foreground mt-1">Skonfiguruj kluczowe parametry silnika Workflow</p>
      </header>
      
      <div className="p-8 max-w-3xl space-y-8">
        {/* Formularz SMTP (wysyłka) */}
        <form onSubmit={handleSaveSMTP} className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="p-6 border-b border-border bg-muted/10 flex items-center gap-3">
            <Mail className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-medium text-foreground">Konfiguracja serwera pocztowego (SMTP)</h2>
          </div>
          
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Serwer SMTP</label>
                <input
                  type="text"
                  placeholder="np. smtp.gmail.com"
                  required
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                  className="w-full border-border rounded-md shadow-sm p-2.5 border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Port</label>
                <input
                  type="number"
                  placeholder="587"
                  required
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  className="w-full border-border rounded-md shadow-sm p-2.5 border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Adres E-mail (Login)</label>
              <input
                type="email"
                placeholder="twoj.adres@domena.pl"
                required
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                className="w-full border-border rounded-md shadow-sm p-2.5 border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Hasło</label>
              <input
                type="password"
                placeholder="Wprowadź hasło lub App Password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border-border rounded-md shadow-sm p-2.5 border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>
          
          <div className="p-6 bg-muted/10 border-t border-border flex items-center justify-between">
            <div>
              {status.message && (
                <span className={`text-sm font-medium ${status.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                  {status.message}
                </span>
              )}
            </div>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 px-6 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {loading ? 'Zapisywanie...' : 'Zapisz ustawienia SMTP'}
            </button>
          </div>
        </form>

        {/* Formularz SMTP (odbiór) */}
        <form onSubmit={handleSaveIMAP} className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="p-6 border-b border-border bg-muted/10 flex items-center gap-3">
            <Inbox className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-medium text-foreground">Konfiguracja odbioru poczty (IMAP)</h2>
          </div>
          
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Serwer IMAP</label>
                <input
                  type="text"
                  placeholder="np. imap.gmail.com"
                  required
                  value={imapServer}
                  onChange={(e) => setImapServer(e.target.value)}
                  className="w-full border-border rounded-md shadow-sm p-2.5 border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Port</label>
                <input
                  type="number"
                  placeholder="993"
                  required
                  value={imapPort}
                  onChange={(e) => setImapPort(e.target.value)}
                  className="w-full border-border rounded-md shadow-sm p-2.5 border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Adres E-mail (Login)</label>
              <input
                type="email"
                placeholder="twoj.adres@domena.pl"
                required
                value={imapLogin}
                onChange={(e) => setImapLogin(e.target.value)}
                className="w-full border-border rounded-md shadow-sm p-2.5 border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Hasło (App Password)</label>
              <input
                type="password"
                placeholder="Wprowadź hasło lub App Password"
                required
                value={imapPassword}
                onChange={(e) => setImapPassword(e.target.value)}
                className="w-full border-border rounded-md shadow-sm p-2.5 border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>
          
          <div className="p-6 bg-muted/10 border-t border-border flex items-center justify-between">
            <div>
              {status.message && (
                <span className={`text-sm font-medium ${status.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                  {status.message}
                </span>
              )}
            </div>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 px-6 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {loading ? 'Zapisywanie...' : 'Zapisz ustawienia IMAP'}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}