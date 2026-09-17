import { useCallback, useEffect, useState } from 'react';
import {
  IonPage, IonContent, IonHeader, IonToolbar, IonTitle,
  IonCard, IonCardContent, IonItem, IonLabel, IonList,
  IonListHeader, IonNote, IonButton, IonIcon, IonAlert,
  IonToast, IonInput, IonAvatar, IonBadge, IonSpinner,
} from '@ionic/react';
import { person, shieldCheckmark, logOut, key, refresh, syncOutline, cloudOfflineOutline, serverOutline } from 'ionicons/icons';
import { useAuth } from '../context/AuthContext';
import { useHistory } from 'react-router-dom';
import { authApi } from '../services/api';
import { db } from '../services/db';
import localApi from '../services/localApi';
import { synchroniserTout, type ResultatSync } from '../services/syncService';
import { useOnline } from '../hooks/useOnline';

export default function Settings() {
  const { user, logout } = useAuth();
  const history = useHistory();
  const online = useOnline();
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const [toastColor, setToastColor] = useState('success');

  // ── Synchronisation (bouton) ──
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [tables, setTables] = useState<Array<{ name: string; rowCount: number }>>([]);
  const [syncResult, setSyncResult] = useState<ResultatSync | null>(null);

  const rechargerStatsLocales = useCallback(async () => {
    try {
      const début = performance.now();
      const [t, d] = await Promise.all([
        localApi.get<Array<{ name: string; rowCount: number }>>('/sqlite/tables'),
        db.getMeta('derniere_synchro'),
      ]);
      console.log(`[SEIMAD:Settings] rechargerStatsLocales → fin en ${Math.round(performance.now() - début)}ms`);
      setTables(Array.isArray(t) ? t : []);
      setLastSync(d);
    } catch (e: any) {
      console.warn(`[SEIMAD:Settings] rechargerStatsLocales → échec`, e?.message || e);
    }
  }, []);

  useEffect(() => { rechargerStatsLocales(); }, [rechargerStatsLocales]);

  const synchroniser = async () => {
    if (syncing || !online) return;
    setSyncing(true);
    console.log(`[SEIMAD:Settings] synchroniser → démarrage (depuis démarrage: ${Math.round(performance.now() - (window as any).__SEIMAD_DÉMARAGE__ || 0)}ms)`);
    try {
      const début = performance.now();
      const res = await synchroniserTout();
      console.log(`[SEIMAD:Settings] synchroniser → fin en ${Math.round(performance.now() - début)}ms`, res);
      setSyncResult(res);
      setToastMsg(
        res.total === 0
          ? '✔ Rien à envoyer — la base locale est à jour'
          : `✔ Synchro : ${res.reussis}/${res.total} envoyé(s)${res.echecs ? ` (${res.echecs} échec(s))` : ''}`
      );
      setToastColor(res.echecs > 0 ? 'warning' : 'success');
      await rechargerStatsLocales();
    } catch (err: any) {
      console.error(`[SEIMAD:Settings] synchroniser → échec`, err?.message || err, err?.stack || '');
      setToastMsg('Synchronisation impossible — vérifiez la connexion');
      setToastColor('danger');
    } finally {
      setSyncing(false);
    }
  };

  const nomTableCourt = (n: string) => ({
    pending_operations: 'À synchroniser (file)',
    map_tiles: 'Tuiles carte',
    referentiels_cache: 'Référentiels',
    geometrie_locale: 'Géométries (GeoJSON)',
  }[n] ?? n);

  const nbLignes = (n: string) => tables.find((t) => t.name === n)?.rowCount ?? 0;

  const handleLogout = async () => {
    await logout();
    history.replace('/login');
  };

  const handleChangePassword = async () => {
    if (!oldPwd || !newPwd || newPwd.length < 6) return;
    try {
      await authApi.changePassword({ ancienMotDePasse: oldPwd, nouveauMotDePasse: newPwd });
      setToastMsg('Mot de passe changé');
      setToastColor('success');
      setShowChangePwd(false);
      setOldPwd(''); setNewPwd('');
    } catch (err: unknown) {
      setToastMsg(err instanceof Error ? err.message : 'Erreur');
      setToastColor('danger');
    }
  };

  return (
    <IonPage>
      <IonHeader>
          <IonToolbar style={{ '--background': '#0d435d', '--color': 'white' }}>
          <IonTitle>👤 Mon profil</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {/* Avatar & Info */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%', background: '#dbeafe',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 12px', fontSize: 28, fontWeight: 'bold', color: '#176b87',
          }}>
            {user?.nomUtilisateur?.charAt(0).toUpperCase()}
          </div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{user?.nomComplet || user?.nomUtilisateur}</h2>
          <p style={{ margin: '4px 0', color: '#6b7280', fontSize: 14 }}>{user?.email || '—'}</p>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            {user?.roles?.map((r, i) => (
              <IonBadge key={r.idRole ?? `role-${r.nomRole}-${i}`} color="primary" style={{ fontSize: 11 }}>{r.nomRole}</IonBadge>
            ))}
          </div>
        </div>

        {/* Info compte */}
        <IonCard style={{ borderRadius: 12 }}>
          <IonListHeader>
            <IonLabel style={{ fontWeight: 600, fontSize: 14, color: '#374151' }}>Informations</IonLabel>
          </IonListHeader>
          <IonList>
            <IonItem lines="none">
              <IonIcon icon={person} slot="start" color="primary" />
              <IonLabel>
                <p style={{ fontSize: 12, color: '#6b7280' }}>Nom d'utilisateur</p>
                <h3 style={{ fontSize: 15, fontWeight: 600 }}>{user?.nomUtilisateur}</h3>
              </IonLabel>
            </IonItem>
            <IonItem lines="none">
              <IonIcon icon={shieldCheckmark} slot="start" color="primary" />
              <IonLabel>
                <p style={{ fontSize: 12, color: '#6b7280' }}>Statut</p>
                <h3 style={{ fontSize: 15, fontWeight: 600 }}>
                  <IonBadge color={user?.actif ? 'success' : 'danger'} style={{ fontSize: 11 }}>
                    {user?.actif ? 'Actif' : 'Inactif'}
                  </IonBadge>
                </h3>
              </IonLabel>
            </IonItem>
            <IonItem lines="none">
              <IonIcon icon={refresh} slot="start" color="primary" />
              <IonLabel>
                <p style={{ fontSize: 12, color: '#6b7280' }}>Dernière connexion</p>
                <h3 style={{ fontSize: 15, fontWeight: 600 }}>
                  {user?.derniereConnexion
                    ? new Date(user.derniereConnexion).toLocaleString('fr-FR')
                    : 'Jamais'}
                </h3>
              </IonLabel>
            </IonItem>
          </IonList>
        </IonCard>

        {/* Synchronisation */}
        <IonCard style={{ borderRadius: 12 }}>
          <IonListHeader>
            <IonLabel style={{ fontWeight: 600, fontSize: 14, color: '#374151' }}>🔄 Synchronisation</IonLabel>
          </IonListHeader>
          <IonCardContent>
            {!online && (
              <div style={{ background: '#fff8e1', border: '1px solid #f0e0a8', color: '#8a6d1d', borderRadius: 8, padding: '8px 10px', fontSize: 12, marginBottom: 10 }}>
                <IonIcon icon={cloudOfflineOutline} style={{ verticalAlign: '-2px' }} /> Hors-ligne — la synchro se fera dès le retour du réseau.
              </div>
            )}
            <div style={{ fontSize: 12.5, color: '#374151', lineHeight: 1.6, marginBottom: 12 }}>
              <div style={{ fontSize: 11.5, color: '#6b7280', marginBottom: 6 }}>
                PUSH uniquement : les signalements créés sur l'appareil sont envoyés vers le serveur. Le mobile ne télécharge pas de données.
              </div>
              {nbLignes('pending_operations') > 0 ? (
                <div style={{ color: '#b7791f' }}>
                  📤 {nbLignes('pending_operations')} signalement(s) local(aux) à envoyer au serveur
                </div>
              ) : (
                <div style={{ color: '#059669' }}>
                  ✔ Aucune donnée locale en attente
                </div>
              )}
              {lastSync && (
                <div style={{ color: '#6b7280', fontSize: 11.5 }}>
                  Dernière synchro : {new Date(lastSync).toLocaleString('fr-FR')}
                </div>
              )}
            </div>

            <IonButton
              expand="block"
              disabled={syncing || !online}
              onClick={synchroniser}
              style={{ '--border-radius': 10, '--background': '#176b87' }}
            >
              {syncing ? <IonSpinner name="crescent" /> : <IonIcon icon={syncOutline} slot="start" />}
              {syncing ? 'Synchronisation en cours…' : 'Synchroniser maintenant'}
            </IonButton>

            {syncResult && syncResult.total > 0 && (
              <div style={{ marginTop: 10, fontSize: 12, background: '#f0f7ff', borderRadius: 8, padding: '8px 10px', color: '#1e3a5f', lineHeight: 1.7 }}>
                <div>📤 <b>Envoyé</b> : {syncResult.reussis}/{syncResult.total}{syncResult.echecs ? ` (${syncResult.echecs} échec(s) — resteront dans la file)` : ''}</div>
              </div>
            )}

            {tables.length > 0 && (
              <div style={{ marginTop: 12, borderTop: '1px solid #eef2f7', paddingTop: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                  <IonIcon icon={serverOutline} style={{ verticalAlign: '-2px' }} /> Base locale — {tables.reduce((s, t) => s + t.rowCount, 0)} lignes
                </div>
                {tables.filter((t) => t.rowCount > 0).map((t) => (
                  <div key={t.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#4b5563', padding: '2px 0' }}>
                    <span>{nomTableCourt(t.name)}</span>
                    <b>{t.rowCount}</b>
                  </div>
                ))}
              </div>
            )}
          </IonCardContent>
        </IonCard>

        {/* Logout */}
        <IonButton
          expand="block"
          fill="outline"
          color="danger"
          onClick={handleLogout}
          style={{ marginTop: 16, '--border-radius': '10px' }}
        >
          <IonIcon icon={logOut} slot="start" />
          Déconnexion
        </IonButton>

        {/* Modal changement mot de passe */}
        <IonAlert
          isOpen={showChangePwd}
          header="Changer le mot de passe"
          inputs={[
            { name: 'old', type: 'password', placeholder: 'Mot de passe actuel' },
            { name: 'new', type: 'password', placeholder: 'Nouveau mot de passe (min. 6)' },
          ]}
          buttons={[
            { text: 'Annuler', role: 'cancel' },
            {
              text: 'Changer',
              handler: async (data) => {
                setOldPwd(data.old);
                setNewPwd(data.new);
                // Hack:直接调用
                if (data.old && data.new && data.new.length >= 6) {
                  try {
                    await authApi.changePassword({ ancienMotDePasse: data.old, nouveauMotDePasse: data.new });
                    setToastMsg('Mot de passe changé');
                    setToastColor('success');
                  } catch (err: unknown) {
                    setToastMsg(err instanceof Error ? err.message : 'Erreur');
                    setToastColor('danger');
                  }
                }
              },
            },
          ]}
          onDidDismiss={() => { setShowChangePwd(false); setOldPwd(''); setNewPwd(''); }}
        />

        <IonToast
          isOpen={!!toastMsg}
          message={toastMsg}
          duration={2000}
          color={toastColor}
          onDidDismiss={() => setToastMsg('')}
        />
      </IonContent>
    </IonPage>
  );
}
