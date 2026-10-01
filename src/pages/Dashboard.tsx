import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IonPage, IonContent, IonRefresher, IonRefresherContent,
  IonCard, IonCardContent, IonLabel, IonButton, IonIcon, IonBadge,
  IonSpinner, IonToast, IonList, IonItem,
} from '@ionic/react';
import {
  syncOutline, cloudOfflineOutline, megaphone,
  cameraOutline, add, chevronForward, logOutOutline,
} from 'ionicons/icons';
import { useAuth } from '../context/AuthContext';
import { useHistory } from 'react-router-dom';
import { synchroniserTout } from '../services/syncService';
import { signalementApi } from '../services/signalementService';
import { useOnline } from '../hooks/useOnline';
import localApi from '../services/localApi';
import type { SignalementDTO } from '../types/signalement';
import { descenteTerrainApi } from '../services/descenteTerrainService';
import type { DescenteTerrainDTO } from '../types/descenteTerrain';

const COULEURS_STATUT: Record<string, string> = {
  nouveau: '#176b87', 'en attente': '#b7791f', 'en cours': '#176b87',
  traite: '#059669', rejete: '#dc2626', transforme: '#7c3aed',
};

function couleurStatut(code?: string, hex?: string): string {
  if (hex) return hex;
  return COULEURS_STATUT[(code || '').toLowerCase()] || '#6b7280';
}

function formaterDate(d?: string): string {
  return d
    ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '—';
}

const COULEURS_DESCENTE: Record<string, string> = {
  conforme: '#059669',
  'non conforme': '#dc2626',
  'en attente': '#b7791f',
  'occupation illicite': '#c53030',
  'construction illegale': '#7c3aed',
};

function couleurDescente(statut?: string): string {
  return COULEURS_DESCENTE[(statut || '').toLowerCase()] || '#6b7280';
}

interface AccueilItem {
  id: string;
  reference: string;
  libelleType: string;
  libelleStatut: string;
  codeStatut?: string;
  couleurStatutHex?: string;
  nomVille?: string;
  date: string;
  enAttente: boolean;
}

/**
 * Derniers signalements serveur (page 1). En cas d'échec réseau, on retombe
 * sur la base locale SQLite via l'API locale — l'écran ne bloque jamais.
 */
async function chargerServeur(): Promise<{ items: AccueilItem[]; total: number }> {
  try {
    const data = await signalementApi.lister(0, 10);
    const items: AccueilItem[] = (data.content ?? []).map((s: SignalementDTO) => ({
      id: s.idSignalement,
      reference: s.reference || '—',
      libelleType: s.libelleType || 'Signalement',
      libelleStatut: s.libelleStatut || 'Nouveau',
      codeStatut: s.codeStatut,
      couleurStatutHex: s.couleurStatutHex,
      nomVille: s.nomVille,
      date: s.dateSignalement || '',
      enAttente: false,
    }));
    return { items, total: Number(data.totalElements ?? items.length) };
  } catch {
    return { items: [], total: 0 }; // serveur injoignable : liste locale seule
  }
}

/**
 * Signalements locaux (file SQLite) — lus via l'API LOCALE de l'application
 * (`localApi`), qui interroge directement la base `seimad_offline`.
 */
async function chargerLocaux(): Promise<AccueilItem[]> {
  try {
    const locaux = await localApi.get<Array<{
      idSignalement: string; reference?: string; libelleType?: string;
      libelleStatut?: string; codeStatut?: string; couleurStatutHex?: string;
      nomVille?: string; dateSignalement?: string;
    }>>('/signalements/offline');
    return locaux.map((s) => ({
      id: s.idSignalement,
      reference: s.reference || '—',
      libelleType: s.libelleType || 'Signalement local',
      libelleStatut: s.libelleStatut || 'En attente',
      codeStatut: s.codeStatut,
      couleurStatutHex: s.couleurStatutHex,
      nomVille: s.nomVille,
      date: s.dateSignalement || '',
      enAttente: true,
    }));
  } catch {
    return []; // base locale non prête (jeep-sqlite en chargement sur web)
  }
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const history = useHistory();
  const online = useOnline();

  const [stats, setStats] = useState({ signalements: 0, photos: 0, enAttente: 0 });
  const [derniers, setDerniers] = useState<AccueilItem[]>([]);
  const [dernieresDescentes, setDernieresDescentes] = useState<DescenteTerrainDTO[]>([]);
  const [chargement, setChargement] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState('');
  const [toastColor, setToastColor] = useState<'success' | 'danger'>('success');
  const [villeIntervention, setVilleIntervention] = useState<string | null>(null);
  const [aujourdhui] = useState(() =>
    new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  );

  // ── Statistiques temps réel + aperçu des derniers signalements ──
  // Hors-ligne : AUCUN appel serveur — uniquement la base SQLite locale (via
  // l'API locale). En ligne : serveur d'abord, repli local en cas d'échec.
  const charger = useCallback(async () => {
    try {
      const [statsLocales, locaux, serveur, descentes] = await Promise.all([
        localApi.get<{ enAttente: number; photos: number }>('/dashboard/stats').catch(() => ({ enAttente: 0, photos: 0 })),
        chargerLocaux(),
        online
          ? chargerServeur()
          : Promise.resolve({ items: [] as AccueilItem[], total: 0 }),
        online
          ? descenteTerrainApi.lister(0, 8).catch(() => ({ content: [] as DescenteTerrainDTO[] }))
          : Promise.resolve({ content: [] as DescenteTerrainDTO[] }),
      ]);
      // Un signalement encore dans la file compte une fois : le serveur ne le
      // connaît pas encore (aucun pull), pas de risque de doublon.
      const locauxNonDupliques = locaux.filter((l) => !serveur.items.some((s) => s.id === l.id));
      const derniersFusionnes = [...locauxNonDupliques, ...serveur.items]
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        .slice(0, 8);

      // Ville d'intervention : déduite des derniers signalements (aucun profil
      // ville n'existe côté backend — la ville est portée par chaque signalement).
      const villeDeduite =
        derniersFusionnes.find((s) => !!s.nomVille)?.nomVille ?? null;
      setVilleIntervention(villeDeduite);

      setStats({
        signalements: (online ? serveur.total : 0) + locauxNonDupliques.length,
        photos: statsLocales.photos,
        enAttente: statsLocales.enAttente,
      });
      setDerniers(derniersFusionnes);
      setDernieresDescentes(descentes.content ?? []);
    } catch {
      // base locale indisponible : statistiques à zéro, écran quand même affiché
    } finally {
      setChargement(false);
    }
  }, [online]);

  useEffect(() => { charger(); }, [charger, online]);

  // ── Synchronisation PUSH (bouton principal) ──
  const synchroniser = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await synchroniserTout();
      setToast(
        res.total === 0
          ? '✔ Rien à synchroniser — données locales déjà envoyées'
          : `✔ ${res.reussis}/${res.total} signalement(s) envoyé(s) au serveur` +
            (res.echecs ? ` — ${res.echecs} échec(s)` : '') +
            (res.photosRefilees ? ` — ${res.photosRefilees} photo(s) en attente de renvoi` : '')
      );
      setToastColor(res.echecs > 0 ? 'danger' : 'success');
    } catch {
      setToast('Synchronisation impossible (hors-ligne ?)');
      setToastColor('danger');
    } finally {
      setSyncing(false);
      charger();
    }
  }, [syncing, charger]);

  const handleRefresh = async (e: CustomEvent) => {
    await charger();
    (e.target as HTMLIonRefresherElement).complete();
  };

  const handleLogout = async () => {
    await logout();
    history.replace('/login');
  };

  const ouvrirDetail = useCallback((item: AccueilItem) => {
    history.push(`/tab/signalements/${item.id}`);
  }, [history]);

  const ouvrirDescente = useCallback((item: DescenteTerrainDTO) => {
    history.push(`/tab/descente-terrain/${item.idDescente}`);
  }, [history]);

  return (
    <IonPage>
      <IonContent fullscreen>
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        {/* ── 1. Bannière de bienvenue ── */}
        <IonCard
          style={{
            margin: '12px 12px 0', borderRadius: 16,
            background: 'linear-gradient(135deg, #0d435d, #176b87)',
            boxShadow: '0 4px 16px rgba(26,86,219,0.25)',
          }}
        >
          <IonCardContent style={{ color: 'white', padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 19, fontWeight: 'bold' }}>
                  Bonjour, {user?.nomComplet || user?.nomUtilisateur} 👋
                </h2>
                <p style={{ margin: '4px 0 0', opacity: 0.9, fontSize: 12.5 }}>
                  🏙️ Ville d'intervention&nbsp;: <b>{villeIntervention || '—'}</b>
                </p>
                <p style={{ margin: '2px 0 0', opacity: 0.75, fontSize: 12 }}>
                  {aujourdhui}
                </p>
              </div>
              <IonButton
                size="small" fill="clear"
                style={{ '--color': 'white', flexShrink: 0 }}
                onClick={handleLogout}
              >
                <IonIcon icon={logOutOutline} slot="icon-only" />
              </IonButton>
            </div>
          </IonCardContent>
        </IonCard>

        {/* ── 2. Statistiques en temps réel ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, margin: '12px 12px 0' }}>
          {[
            { icon: megaphone, valeur: chargement ? '…' : String(stats.signalements), label: 'Signalements', color: '#176b87' },
            { icon: cameraOutline, valeur: chargement ? '…' : String(stats.photos), label: 'Photos', color: '#059669' },
            { icon: cloudOfflineOutline, valeur: chargement ? '…' : String(stats.enAttente), label: 'À synchroniser', color: '#b7791f' },
          ].map((s) => (
            <IonCard key={s.label} style={{ borderRadius: 12, margin: 0 }}>
              <IonCardContent style={{ textAlign: 'center', padding: 12 }}>
                <IonIcon icon={s.icon} style={{ fontSize: 20, color: s.color }} />
                <div style={{ fontSize: 22, fontWeight: 'bold', color: s.color, lineHeight: 1.2 }}>{s.valeur}</div>
                <div style={{ fontSize: 10.5, color: '#6b7280', fontWeight: 600 }}>{s.label}</div>
              </IonCardContent>
            </IonCard>
          ))}
        </div>

        {/* ── 3. Bouton principal « Synchroniser push » ── */}
        <div style={{ margin: '12px 12px 0', display: 'flex', gap: 10 }}>
          <IonButton
            expand="block"
            onClick={synchroniser}
            disabled={syncing || (!online && stats.enAttente === 0)}
            style={{ flex: 1, '--border-radius': '12px', fontWeight: 600 }}
          >
            {syncing ? <IonSpinner name="crescent" /> : <IonIcon icon={syncOutline} slot="start" />}
            {syncing ? 'Synchronisation…' : 'Synchroniser push'}
          </IonButton>
          <IonButton
            onClick={() => history.push('/tab/signalements/nouveau')}
            style={{ '--border-radius': '12px', '--background': '#059669' }}
          >
            <IonIcon icon={add} slot="start" />
            Nouveau
          </IonButton>
        </div>

        {/* ── 4. Indicateur d'état : hors-ligne / à synchroniser ── */}
        {(!online || stats.enAttente > 0) && (
          <div
            style={{
              margin: '12px 12px 0', padding: '10px 12px', borderRadius: 10,
              display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5,
              background: online ? '#fff8e1' : '#fef2f2',
              border: `1px solid ${online ? '#f0e0a8' : '#fecaca'}`,
              color: online ? '#8a6d1d' : '#b91c1c',
            }}
          >
            <IonIcon icon={online ? syncOutline : cloudOfflineOutline} style={{ fontSize: 20 }} />
            <span style={{ flex: 1 }}>
              {!online
                ? `📴 Hors-ligne — ${stats.enAttente > 0 ? `${stats.enAttente} signalement(s) à synchroniser` : 'aucune donnée locale en attente'}`
                : `${stats.enAttente} signalement(s) en attente de synchronisation`}
            </span>
          </div>
        )}

        {/* ── 5. Aperçu des derniers signalements ── */}
        <div style={{ margin: '16px 12px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#374151' }}>
            Derniers signalements
          </h3>
          <IonButton
            size="small" fill="clear"
            onClick={() => history.push('/tab/signalements')}
            style={{ '--color': '#176b87', fontSize: 12.5 }}
          >
            Tout voir <IonIcon icon={chevronForward} />
          </IonButton>
        </div>

        {chargement ? (
          <div style={{ textAlign: 'center', padding: 30 }}>
            <IonSpinner name="crescent" />
          </div>
        ) : derniers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 30, color: '#9ca3af', fontSize: 13 }}>
            <div style={{ fontSize: 34, marginBottom: 6 }}>🚧</div>
            Aucun signalement pour le moment.
            <div style={{ marginTop: 6, fontSize: 12 }}>
              Créez le premier depuis «&nbsp;Nouveau&nbsp;» ou l'onglet Signalements.
            </div>
          </div>
        ) : (
          <IonList style={{ margin: '0 12px 8px', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
            {derniers.map((item) => (
              <IonItem key={item.id} button detail={false} onClick={() => ouvrirDetail(item)} lines="inset">
                <IonLabel>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <b style={{ fontSize: 13.5 }}>{item.reference}</b>
                    <IonBadge style={{ background: couleurStatut(item.codeStatut, item.couleurStatutHex), color: '#fff', fontSize: 9.5 }}>
                      {item.libelleStatut}
                    </IonBadge>
                    {item.enAttente && (
                      <IonBadge style={{ background: '#b7791f', color: '#fff', fontSize: 9.5 }}>Local</IonBadge>
                    )}
                  </div>
                  <p style={{ fontSize: 12, color: '#374151', margin: '4px 0 0' }}>
                    {item.libelleType}
                    {item.nomVille ? ` · ${item.nomVille}` : ''}
                    {' · '}{formaterDate(item.date)}
                  </p>
                </IonLabel>
                <IonIcon icon={chevronForward} slot="end" style={{ color: '#cbd5e1' }} />
              </IonItem>
            ))}
          </IonList>
        )}

        {/* ── Dernières descentes terrain ── */}
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: '16px 12px 8px', color: '#374151' }}>
          Dernières descentes
        </h3>
        {chargement ? (
          <div style={{ textAlign: 'center', padding: 30 }}><IonSpinner name="crescent" /></div>
        ) : dernieresDescentes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 30, color: '#9ca3af', fontSize: 13 }}>
            <div style={{ fontSize: 34, marginBottom: 6 }}>📋</div>
            Aucune descente pour le moment.
          </div>
        ) : (
          <IonList style={{ margin: '0 12px 24px', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
            {dernieresDescentes.map((item) => (
              <IonItem key={item.idDescente} button detail={false} onClick={() => ouvrirDescente(item)} lines="inset">
                <IonLabel>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <b style={{ fontSize: 13.5 }}>{item.reference || 'Descente terrain'}</b>
                    <IonBadge style={{ background: couleurDescente(item.statutConstat), color: '#fff', fontSize: 9.5 }}>
                      {item.statutConstat}
                    </IonBadge>
                  </div>
                  <p style={{ fontSize: 12, color: '#374151', margin: '4px 0 0' }}>
                    {item.nomPersonne || item.demandeurNom || '—'}
                    {(item.numeroDossier || item.dossierNumero) ? ` · ${item.numeroDossier || item.dossierNumero}` : ''}
                    {' · '}{formaterDate(item.dateDescente)}
                  </p>
                </IonLabel>
                <IonIcon icon={chevronForward} slot="end" style={{ color: '#cbd5e1' }} />
              </IonItem>
            ))}
          </IonList>
        )}

        <IonToast
          isOpen={!!toast}
          message={toast}
          duration={2500}
          color={toastColor}
          onDidDismiss={() => setToast('')}
        />
      </IonContent>
    </IonPage>
  );
}
