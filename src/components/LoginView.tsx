import React, { useState } from 'react';
import {
  Ban,
  Check,
  CheckCircle2,
  Clock,
  Laptop,
  LogOut,
  Pencil,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Store,
  Tablet,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useBackLayer } from '../contexts/NavigationContext';
import {
  deviceTypeLabel,
  isAllowedDeviceName,
  REQUIRED_DEVICE_NAME,
} from '../utils/device';

export const LoginView: React.FC = () => {
  const {
    firebaseUser,
    profile,
    loading,
    signingIn,
    authError,
    isDeviceBlocked,
    deviceIdentity,
    deviceRecord,
    signInWithGoogle,
    retryProfileSync,
    logout,
    updateCurrentDeviceName,
  } = useAuth();

  const [editingDevice, setEditingDevice] = useState(false);
  const [deviceDraft, setDeviceDraft] = useState(deviceIdentity.deviceName);
  const [savingDevice, setSavingDevice] = useState(false);
  const [localAuthNotice, setLocalAuthNotice] = useState<string | null>(null);

  useBackLayer({
    id: 'login-edit-device',
    active: editingDevice,
    onClose: () => setEditingDevice(false),
  });

  const isCurrentNameAllowed = isAllowedDeviceName(
    deviceRecord?.deviceName || deviceIdentity.deviceName
  );

  const DeviceIcon =
    deviceIdentity.deviceType === 'mobile'
      ? Smartphone
      : deviceIdentity.deviceType === 'tablet'
      ? Tablet
      : Laptop;

  const handleSaveDeviceName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceDraft.trim()) return;
    setSavingDevice(true);
    setLocalAuthNotice(null);
    try {
      await updateCurrentDeviceName(deviceDraft);
      setEditingDevice(false);
    } finally {
      setSavingDevice(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-slate-50 flex items-center justify-center p-4 sm:p-6">
        <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-md w-full text-center space-y-3">
          <div className="w-10 h-10 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-slate-700 font-medium">جاري التحقق من الحساب والصلاحيات والجهاز...</p>
        </div>
      </div>
    );
  }

  if (firebaseUser && isDeviceBlocked) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-red-200 rounded-xl p-8 max-w-md w-full space-y-5 text-center">
          <div className="w-12 h-12 rounded-xl bg-red-50 border border-red-200 text-red-600 flex items-center justify-center mx-auto">
            <Ban className="w-6 h-6" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-bold text-slate-900">تم حظر هذا الجهاز</h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              تم تعطيل الوصول من الجهاز{' '}
              <strong className="text-slate-900">
                {deviceRecord?.deviceName || deviceIdentity.deviceName}
              </strong>{' '}
              بواسطة مسؤول النظام. لا يمكن تنفيذ عمليات بيع أو الاطلاع على البيانات من هذا الجهاز حتى تتم إعادة تفعيله.
            </p>
            <div className="text-xs font-mono-num text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
              معرّف الجهاز: {deviceIdentity.deviceId}
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </div>
    );
  }

  if (firebaseUser && !isCurrentNameAllowed) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border-2 border-amber-300 rounded-2xl p-8 max-w-md w-full space-y-5 text-center shadow-xs">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-7 h-7" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-bold text-slate-900">الجهاز غير مصرح له بالدخول</h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              فقط يُسمح بتسجيل الدخول لأي جهاز يقوم بتسجيل اسم الجهاز بهذا الاسم:
              <span className="block mt-2 font-bold text-base text-emerald-800 bg-emerald-50 border border-emerald-300 py-2 px-3 rounded-xl">
                «{REQUIRED_DEVICE_NAME}»
              </span>
            </p>
            <div className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-700 mt-2">
              اسم هذا الجهاز الحالي:{' '}
              <span className="font-semibold text-red-600">
                {deviceRecord?.deviceName || deviceIdentity.deviceName}
              </span>
            </div>
          </div>

          <div className="space-y-2.5 pt-1">
            <button
              type="button"
              disabled={savingDevice}
              onClick={async () => {
                setSavingDevice(true);
                try {
                  await updateCurrentDeviceName(REQUIRED_DEVICE_NAME);
                } finally {
                  setSavingDevice(false);
                }
              }}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors cursor-pointer shadow-xs"
            >
              <Check className="w-4 h-4" />
              <span>
                {savingDevice
                  ? 'جاري اعتماد الاسم...'
                  : `تسجيل الجهاز باسم «${REQUIRED_DEVICE_NAME}» وتفعيل الدخول`}
              </span>
            </button>

            <button
              onClick={logout}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>تسجيل الخروج</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (firebaseUser && profile && profile.status === 'suspended') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-md w-full space-y-5 text-center">
          <div className="w-12 h-12 rounded-xl bg-red-50 border border-red-200 text-red-600 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-bold text-slate-900">تم إيقاف هذا الحساب</h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              حسابك ({profile.email}) موقوف حالياً من قبل مسؤول النظام في بقالة الحسام. يرجى التواصل مع الإدارة لتفعيل الصلاحية.
            </p>
          </div>
          <button
            onClick={logout}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </div>
    );
  }

  if (firebaseUser && profile && profile.status === 'pending') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-md w-full space-y-5 text-center">
          <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center mx-auto">
            <Clock className="w-6 h-6" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-bold text-slate-900">بانتظار تفعيل الصلاحية</h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              تم تسجيل دخولك بنجاح عبر البريد{' '}
              <span className="font-mono-num font-semibold text-slate-900" dir="ltr">
                {profile.email}
              </span>
              . حسابك الآن قيد المراجعة من قبل المسؤول الرئيسي لتحديد دورك وصلاحياتك داخل بقالة الحسام.
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-right space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">اسم هذا الجهاز ({deviceTypeLabel(deviceIdentity.deviceType)}):</span>
              {!editingDevice && (
                <button
                  type="button"
                  onClick={() => {
                    setDeviceDraft(deviceIdentity.deviceName);
                    setEditingDevice(true);
                  }}
                  className="inline-flex items-center gap-1 text-emerald-700 font-semibold hover:underline cursor-pointer"
                >
                  <Pencil className="w-3 h-3" />
                  <span>تسمية الجهاز</span>
                </button>
              )}
            </div>
            {editingDevice ? (
              <form onSubmit={handleSaveDeviceName} className="flex gap-2">
                <input
                  type="text"
                  value={deviceDraft}
                  onChange={(e) => setDeviceDraft(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
                  placeholder="مثال: هاتف الكاشير 1"
                />
                <button
                  type="submit"
                  disabled={savingDevice}
                  className="px-3 py-1.5 bg-emerald-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  حفظ
                </button>
              </form>
            ) : (
              <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                <DeviceIcon className="w-4 h-4 text-slate-600" />
                <span>{deviceIdentity.deviceName}</span>
                <span className="text-slate-400">({deviceIdentity.platform})</span>
              </div>
            )}
          </div>

          <button
            onClick={logout}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </div>
    );
  }

  if (firebaseUser && !profile) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-md w-full space-y-5 text-center">
          <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center mx-auto">
            <Clock className="w-6 h-6" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-bold text-slate-900">استكمال التحقق من الحساب</h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              تم تسجيل دخولك عبر{' '}
              <span className="font-mono-num font-semibold text-slate-900" dir="ltr">
                {firebaseUser.email}
              </span>
              .
            </p>
            {authError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs text-right leading-relaxed">
                {authError}
              </div>
            )}
          </div>
          <div className="space-y-2.5">
            <button
              type="button"
              onClick={retryProfileSync}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-700 text-white text-sm font-semibold rounded-lg hover:bg-emerald-800 transition-colors cursor-pointer"
            >
              <span>إعادة التحقق والمزامنة</span>
            </button>
            <button
              type="button"
              onClick={logout}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>تسجيل الخروج</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-slate-50 flex flex-col justify-center items-center p-4 sm:p-6">
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 md:p-10 space-y-6 sm:space-y-7">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-emerald-700 text-white flex items-center justify-center shrink-0">
            <Store className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">بقالة الحسام</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              النظام المحاسبي السحابي متعدد الأجهزة · الريال اليمني (ر.ي)
            </p>
          </div>
        </div>

        {/* Local Device Identity Box */}
        <div
          className={`rounded-xl p-4 space-y-3 border transition-colors ${
            isCurrentNameAllowed
              ? 'bg-emerald-50/70 border-emerald-300'
              : 'bg-amber-50/80 border-2 border-amber-300'
          }`}
        >
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 font-semibold">
              <DeviceIcon
                className={`w-4 h-4 ${
                  isCurrentNameAllowed ? 'text-emerald-700' : 'text-amber-700'
                }`}
              />
              <span
                className={
                  isCurrentNameAllowed
                    ? 'text-emerald-950 font-bold'
                    : 'text-slate-800 font-bold'
                }
              >
                اسم هذا الجهاز: {deviceIdentity.deviceName}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {isCurrentNameAllowed ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-100/90 border border-emerald-300 px-2.5 py-0.5 rounded-full">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>مصرح بالدخول ✓</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-full">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>مطلوب اعتماد الاسم</span>
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  setDeviceDraft(deviceIdentity.deviceName);
                  setEditingDevice((v) => !v);
                }}
                className="text-emerald-700 font-semibold hover:underline cursor-pointer mr-1"
              >
                {editingDevice ? 'إلغاء' : 'تعديل'}
              </button>
            </div>
          </div>

          {!isCurrentNameAllowed && (
            <div className="p-3 bg-white/95 border border-amber-200 rounded-xl text-xs space-y-2.5 shadow-2xs">
              <div className="flex items-start gap-2 text-amber-900 leading-relaxed">
                <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <strong>شرط الأمان للدخول:</strong> فقط يسمح تسجيل الدخول لأي جهاز يقوم بتسجيل اسم الجهاز بهذا الاسم{' '}
                  <span className="text-emerald-700 font-bold underline">«{REQUIRED_DEVICE_NAME}»</span>.
                </div>
              </div>
              <button
                type="button"
                disabled={savingDevice}
                onClick={async () => {
                  setSavingDevice(true);
                  setLocalAuthNotice(null);
                  try {
                    setDeviceDraft(REQUIRED_DEVICE_NAME);
                    await updateCurrentDeviceName(REQUIRED_DEVICE_NAME);
                    setEditingDevice(false);
                  } finally {
                    setSavingDevice(false);
                  }
                }}
                className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer shadow-xs"
              >
                <Check className="w-4 h-4" />
                <span>
                  {savingDevice
                    ? 'جاري الحفظ...'
                    : `تسجيل الجهاز باسم «${REQUIRED_DEVICE_NAME}» بنقرة واحدة`}
                </span>
              </button>
            </div>
          )}

          {editingDevice && (
            <form onSubmit={handleSaveDeviceName} className="space-y-2 pt-1">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={deviceDraft}
                  onChange={(e) => setDeviceDraft(e.target.value)}
                  placeholder={`اكتب: ${REQUIRED_DEVICE_NAME}`}
                  className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-emerald-600"
                />
                <button
                  type="submit"
                  disabled={savingDevice}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>حفظ</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => setDeviceDraft(REQUIRED_DEVICE_NAME)}
                className="text-[11px] text-emerald-700 font-semibold hover:underline inline-flex items-center gap-1 cursor-pointer"
              >
                <span>تعيين القيمة تلقائياً إلى «{REQUIRED_DEVICE_NAME}»</span>
              </button>
            </form>
          )}

          <div className="text-[11px] text-slate-500">
            {deviceTypeLabel(deviceIdentity.deviceType)} · {deviceIdentity.platform} ·{' '}
            {isCurrentNameAllowed
              ? 'الجهاز معتمد ومسموح له بإجراء العمليات'
              : `يجب مطابقة الاسم «${REQUIRED_DEVICE_NAME}» لتسجيل الدخول`}
          </div>
        </div>

        <div className="border-t border-slate-100 pt-6 space-y-4">
          <div className="space-y-1.5">
            <h2 className="text-base font-semibold text-slate-900">
              تسجيل الدخول إلى النظام
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              سجّل الدخول بحساب Google المعتمد للمسؤول أو الموظف للوصول إلى شاشة البيع والمخزون والمزامنة اللحظية عبر جميع الأجهزة.
            </p>
          </div>

          {localAuthNotice && (
            <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-xs leading-relaxed flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <span>{localAuthNotice}</span>
            </div>
          )}

          {authError && (
            <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              {authError}
            </div>
          )}

          <button
            type="button"
            onClick={async () => {
              try {
                if (!isAllowedDeviceName(deviceIdentity.deviceName)) {
                  await updateCurrentDeviceName(REQUIRED_DEVICE_NAME);
                }
              } catch {
                // Ignore device rename notice and proceed with sign in
              }
              setLocalAuthNotice(null);
              await signInWithGoogle();
            }}
            disabled={signingIn}
            className={`w-full flex items-center justify-center gap-3 px-5 py-3 ${
              isCurrentNameAllowed
                ? 'bg-emerald-700 hover:bg-emerald-800'
                : 'bg-slate-700 hover:bg-slate-800'
            } disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-xl transition-colors cursor-pointer shadow-xs`}
          >
            {signingIn ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>جاري تسجيل الدخول عبر Google...</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27c3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10c5.35 0 9.25-3.67 9.25-9.09c0-1.15-.15-1.81-.15-1.81Z"
                  />
                </svg>
                <span>الدخول باستخدام حساب Google</span>
              </>
            )}
          </button>
        </div>

        <div className="border-t border-slate-100 pt-5 grid grid-cols-3 gap-4 text-center text-xs text-slate-500">
          <div>مزامنة سحابية فورية</div>
          <div>حماية وتعدد أجهزة</div>
          <div>معالجة انقطاع النت</div>
        </div>
      </div>
    </div>
  );
};
