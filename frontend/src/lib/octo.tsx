import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { apiSend, SIGNED_OUT_EVENT } from './api';
import type { GalleryItem } from './types';

// App-level UI state, the counterpart to the data in WorkspaceProvider: which
// view is open, which modal, the one-time secrets, the confirmation code, and
// the Access-view filters. Kept in one place because the actions that produce
// them (mint, share, create, delete) are spread across every view.

export type View = 'overview' | 'files' | 'gallery' | 'operations' | 'access';
export type Modal =
  | 'workspace'
  | 'text-file'
  | 'key'
  | 'share'
  | 'key-created'
  | 'share-created'
  | 'delete-workspace'
  | 'preview'
  | 'mfa-enroll'
  | 'mfa-recovery'
  | null;

export const ALLOWANCES = ['read', 'write', 'files', 'delete'] as const;

interface OctoContextValue {
  view: View;
  setView: (view: View) => void;
  modal: Modal;
  openModal: (modal: Modal) => void;
  closeModal: () => void;
  modalError: string;
  setModalError: (error: string) => void;
  oneTimeSecret: string;
  oneTimeLabel: string;
  oneTimeKind: 'key' | 'workspace' | null;
  showOneTime: (value: { secret: string; kind: 'key' | 'workspace'; label?: string }) => void;
  shareUrl: string;
  setShareUrl: (url: string) => void;
  clearOneTime: () => void;
  previewItem: GalleryItem | null;
  setPreviewItem: (item: GalleryItem | null) => void;
  confirmCode: string;
  refreshConfirmCode: () => Promise<void>;
  mfaSetupSecret: string;
  mfaSetupUri: string;
  setMfaSetup: (setup: { secret: string; uri: string }) => void;
  mfaRecoveryCodes: string[];
  setMfaRecoveryCodes: (codes: string[]) => void;
  keyFilter: string;
  setKeyFilter: (value: string) => void;
  keyView: 'table' | 'cards';
  setKeyView: (value: 'table' | 'cards') => void;
  shareFilter: string;
  setShareFilter: (value: string) => void;
  shareView: 'table' | 'cards';
  setShareView: (value: 'table' | 'cards') => void;
}

const OctoContext = createContext<OctoContextValue | null>(null);

export function OctoProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<View>('overview');
  const [modal, setModal] = useState<Modal>(null);
  const [modalError, setModalError] = useState('');
  const [oneTimeSecret, setOneTimeSecret] = useState('');
  const [oneTimeLabel, setOneTimeLabel] = useState('');
  const [oneTimeKind, setOneTimeKind] = useState<'key' | 'workspace' | null>(null);
  const [shareUrl, setShareUrl] = useState('');
  const [previewItem, setPreviewItem] = useState<GalleryItem | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [mfaSetupSecret, setMfaSetupSecret] = useState('');
  const [mfaSetupUri, setMfaSetupUri] = useState('');
  const [mfaRecoveryCodes, setMfaRecoveryCodes] = useState<string[]>([]);
  const [keyFilter, setKeyFilter] = useState('');
  const [keyView, setKeyView] = useState<'table' | 'cards'>('table');
  const [shareFilter, setShareFilter] = useState('');
  const [shareView, setShareView] = useState<'table' | 'cards'>('table');

  const openModal = useCallback((next: Modal) => {
    setModalError('');
    setModal(next);
  }, []);

  const closeModal = useCallback(() => {
    setModalError('');
    setPreviewItem(null);
    setModal(null);
  }, []);

  const showOneTime = useCallback(
    (value: { secret: string; kind: 'key' | 'workspace'; label?: string }) => {
      setOneTimeSecret(value.secret);
      setOneTimeKind(value.kind);
      setOneTimeLabel(value.label ?? '');
    },
    []
  );

  const clearOneTime = useCallback(() => {
    setOneTimeSecret('');
    setOneTimeLabel('');
    setOneTimeKind(null);
    setShareUrl('');
  }, []);

  // A one-time secret belongs to the session that minted it. Sign-out must drop
  // it, or the next person on this machine is shown the previous key.
  useEffect(() => {
    const onSignedOut = () => {
      clearOneTime();
      setConfirmCode('');
      setModal(null);
      setModalError('');
      setPreviewItem(null);
      setView('overview');
    };
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, [clearOneTime]);

  const refreshConfirmCode = useCallback(async () => {
    try {
      const issued = await apiSend<{ code: string }>('/api/me/confirm-challenge', 'POST');
      setConfirmCode(issued.code);
    } catch {
      setConfirmCode('');
    }
  }, []);

  const setMfaSetup = useCallback((setup: { secret: string; uri: string }) => {
    setMfaSetupSecret(setup.secret);
    setMfaSetupUri(setup.uri);
  }, []);

  const value = useMemo<OctoContextValue>(
    () => ({
      view,
      setView,
      modal,
      openModal,
      closeModal,
      modalError,
      setModalError,
      oneTimeSecret,
      oneTimeLabel,
      oneTimeKind,
      showOneTime,
      shareUrl,
      setShareUrl,
      clearOneTime,
      previewItem,
      setPreviewItem,
      confirmCode,
      refreshConfirmCode,
      mfaSetupSecret,
      mfaSetupUri,
      setMfaSetup,
      mfaRecoveryCodes,
      setMfaRecoveryCodes,
      keyFilter,
      setKeyFilter,
      keyView,
      setKeyView,
      shareFilter,
      setShareFilter,
      shareView,
      setShareView,
    }),
    [
      view,
      modal,
      openModal,
      closeModal,
      modalError,
      oneTimeSecret,
      oneTimeLabel,
      oneTimeKind,
      showOneTime,
      shareUrl,
      clearOneTime,
      previewItem,
      confirmCode,
      refreshConfirmCode,
      mfaSetupSecret,
      mfaSetupUri,
      setMfaSetup,
      mfaRecoveryCodes,
      keyFilter,
      keyView,
      shareFilter,
      shareView,
    ]
  );

  return <OctoContext.Provider value={value}>{children}</OctoContext.Provider>;
}

export function useOcto(): OctoContextValue {
  const context = useContext(OctoContext);
  if (!context) throw new Error('useOcto must be used within OctoProvider');
  return context;
}
