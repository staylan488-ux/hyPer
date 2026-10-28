import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useRef, useState, type ComponentRef, type Ref } from 'react';
import { Keyboard, Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuthStore } from '@/stores/authStore';
import { BlancText } from '~/components/BlancText';
import { BrandMark, EMBLEM_MARK_SIZE } from '~/components/BrandMark';
import { Capsule } from '~/components/Capsule';
import { Label } from '~/components/Label';
import { Hairline } from '~/components/Row';
import { useIntroRise } from '~/lib/brand';
import { haptics } from '~/lib/haptics';
import { SIGN_IN_CANCELLED } from '~/platform/nativeAuth';
import { space, useBlanc } from '~/theme/blanc';

// Same rules and words as the web sign-in form (src/components/auth/AuthForm.tsx).
const SIGNUP_SUCCESS_MESSAGE = 'Account created. Check your email to verify before signing in.';
const MIN_PASSWORD_LENGTH = 6;
const SHORT_PASSWORD_MESSAGE = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;

type InputRef = ComponentRef<typeof TextInput>;
type Provider = 'apple' | 'google';

export default function SignIn() {
  const c = useBlanc();
  const insets = useSafeAreaInsets();
  const rise = useIntroRise();
  const { signIn, signUp, resendSignupConfirmation, signInWithGoogle, signInWithApple, loading } = useAuthStore();

  const [isLogin, setIsLogin] = useState(true);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [signupSuccess, setSignupSuccess] = useState<string | null>(null);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);
  const [showSignInPrompt, setShowSignInPrompt] = useState(false);
  const [signupButtonLocked, setSignupButtonLocked] = useState(false);
  const [resendingVerification, setResendingVerification] = useState(false);
  const [provider, setProvider] = useState<Provider | null>(null);

  const emailRef = useRef<InputRef>(null);
  const passwordRef = useRef<InputRef>(null);

  const trimmedEmail = email.trim();
  const canSubmit = trimmedEmail.length > 0 && password.length >= MIN_PASSWORD_LENGTH;
  const busy = loading || provider !== null;

  const clearSignupSignals = () => {
    setSignupSuccess(null);
    setPendingVerificationEmail(null);
    setShowSignInPrompt(false);
    setSignupButtonLocked(false);
  };

  const switchMode = (login: boolean) => {
    clearSignupSignals();
    setIsLogin(login);
    setError(null);
  };

  const submit = async () => {
    if (!canSubmit || busy) return;
    Keyboard.dismiss();
    setError(null);

    if (isLogin) {
      clearSignupSignals();
      const { error: signInError } = await signIn(trimmedEmail, password);
      if (signInError) {
        haptics.error();
        setError(signInError.message);
      }
      return;
    }

    if (signupButtonLocked) return;
    const { error: signUpError, existingAccount } = await signUp(trimmedEmail, password, displayName);
    if (signUpError) {
      haptics.error();
      setError(signUpError.message);
      setShowSignInPrompt(existingAccount);
      setSignupSuccess(null);
      setPendingVerificationEmail(null);
      setSignupButtonLocked(false);
      return;
    }

    haptics.success();
    setSignupSuccess(SIGNUP_SUCCESS_MESSAGE);
    setPendingVerificationEmail(trimmedEmail);
    setShowSignInPrompt(false);
    setSignupButtonLocked(true);
    setDisplayName('');
    setPassword('');
  };

  const continueWith = async (which: Provider) => {
    if (busy) return;
    clearSignupSignals();
    setError(null);
    setProvider(which);
    const { error: providerError } = await (which === 'google' ? signInWithGoogle() : signInWithApple());
    setProvider(null);
    // Closing the sheet is a choice, not a failure.
    if (providerError && providerError.message !== SIGN_IN_CANCELLED) {
      haptics.error();
      setError(providerError.message);
    }
  };

  // Go on the keyboard with the form not ready says what is missing; the
  // button stays disabled meanwhile, as before.
  const submitFromKeyboard = () => {
    if (busy) return;
    if (!trimmedEmail) {
      emailRef.current?.focus();
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      haptics.error();
      setError(SHORT_PASSWORD_MESSAGE);
      return;
    }
    void submit();
  };

  const resendVerification = async () => {
    const targetEmail = pendingVerificationEmail || trimmedEmail;
    if (!targetEmail || resendingVerification) return;
    setResendingVerification(true);
    setError(null);
    try {
      const { error: resendError } = await resendSignupConfirmation(targetEmail);
      if (resendError) {
        haptics.error();
        setError(resendError.message);
        return;
      }
      haptics.success();
      setSignupSuccess(`Verification email resent to ${targetEmail}. Check spam or promotions if it doesn't appear.`);
    } finally {
      setResendingVerification(false);
    }
  };

  return (
    <KeyboardAwareScrollView
      bottomOffset={24}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      style={{ flex: 1, backgroundColor: c.ground }}
      contentContainerStyle={{ paddingTop: insets.top + 44, paddingBottom: insets.bottom + 28 }}>
      {/* The launch intro lands on the mark; the rest rises in under it. */}
      <View style={{ paddingHorizontal: space.gutter, alignItems: 'flex-start' }}>
        <BrandMark size={EMBLEM_MARK_SIZE} anchor tight />
      </View>
      <Animated.View style={rise}>
        <View style={{ paddingHorizontal: space.gutter, gap: 10, marginTop: 18 }}>
          <BlancText variant="title" size={34} weight="700" accessibilityRole="header">
            hyPer
          </BlancText>
          <BlancText variant="secondary" tone="graphite">
            Your training and food, in one log.
          </BlancText>
        </View>

        <BlancText variant="section" style={{ marginHorizontal: space.gutter, marginTop: 36, marginBottom: 10 }}>
          {isLogin ? 'Sign in' : 'Create account'}
        </BlancText>

        <Label>
          {!isLogin ? (
            <>
              <Field
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Name"
                accessibilityLabel="Name"
                textContentType="name"
                autoComplete="name"
                autoCapitalize="words"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => emailRef.current?.focus()}
              />
              <Hairline />
            </>
          ) : null}
          <Field
            ref={emailRef}
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            accessibilityLabel="Email"
            keyboardType="email-address"
            textContentType="username"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect={false}
            // Return stays dim until there is something to send (the name is optional).
            enablesReturnKeyAutomatically
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <Hairline />
          <Field
            ref={passwordRef}
            value={password}
            onChangeText={(next) => {
              if (error === SHORT_PASSWORD_MESSAGE && next.length >= MIN_PASSWORD_LENGTH) setError(null);
              setPassword(next);
            }}
            placeholder="Password"
            accessibilityLabel="Password"
            secureTextEntry
            textContentType={isLogin ? 'password' : 'newPassword'}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            passwordRules={`minlength: ${MIN_PASSWORD_LENGTH};`}
            enablesReturnKeyAutomatically
            returnKeyType="go"
            onSubmitEditing={submitFromKeyboard}
          />
        </Label>

        <View style={{ marginHorizontal: space.gutter, marginTop: 14, gap: 8 }}>
          {!isLogin && signupSuccess ? (
            <>
              <BlancText variant="secondary">{signupSuccess}</BlancText>
              <BlancText variant="footnote" tone="graphite">
                Verification emails can land in spam, junk, or promotions.
              </BlancText>
              {pendingVerificationEmail || trimmedEmail ? (
                <TextLink
                  title={resendingVerification ? 'Resending…' : 'Resend verification email'}
                  onPress={() => void resendVerification()}
                  disabled={resendingVerification}
                />
              ) : null}
            </>
          ) : null}
          {error ? (
            <BlancText variant="secondary" tone="live" accessibilityRole="alert">
              {error}
            </BlancText>
          ) : null}
          {!isLogin && showSignInPrompt ? <TextLink title="Go to sign in" onPress={() => switchMode(true)} /> : null}
        </View>

        <View style={{ marginHorizontal: space.inset, marginTop: 18, gap: 12 }}>
          <Capsule
            title={isLogin ? 'Sign in' : signupButtonLocked ? 'Check your email' : 'Create account'}
            size="large"
            fill
            busy={loading && provider === null && !(signupButtonLocked && !isLogin)}
            disabled={!canSubmit || provider !== null || (!isLogin && signupButtonLocked)}
            onPress={() => void submit()}
          />

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 6 }}>
            <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: c.hairline }} />
            <BlancText variant="footnote" tone="graphite">
              or
            </BlancText>
            <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: c.hairline }} />
          </View>

          <Capsule
            title="Continue with Apple"
            variant="quiet"
            size="large"
            fill
            busy={provider === 'apple'}
            disabled={busy && provider !== 'apple'}
            icon={<SymbolView name="apple.logo" size={17} tintColor={c.ink} />}
            onPress={() => void continueWith('apple')}
          />
          <Capsule
            title="Continue with Google"
            variant="quiet"
            size="large"
            fill
            busy={provider === 'google'}
            disabled={busy && provider !== 'google'}
            icon={
              <Image
                source={require('../../assets/images/google-g.svg')}
                tintColor={c.ink}
                style={{ width: 15, height: 15 }}
                accessible={false}
              />
            }
            onPress={() => void continueWith('google')}
          />
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 26 }}>
          <BlancText variant="secondary" tone="graphite">
            {isLogin ? 'No account?' : 'Have an account?'}
          </BlancText>
          <TextLink title={isLogin ? 'Sign up' : 'Sign in'} onPress={() => switchMode(!isLogin)} />
        </View>
      </Animated.View>
    </KeyboardAwareScrollView>
  );
}

function Field({ ref, style, ...props }: TextInputProps & { ref?: Ref<InputRef> }) {
  const c = useBlanc();
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={c.graphite}
      selectionColor={c.ink}
      style={[{ minHeight: 50, paddingHorizontal: 18, fontSize: 17, color: c.ink }, style]}
      {...props}
    />
  );
}

function TextLink({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={10}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => ({ paddingHorizontal: 6, paddingVertical: 4, opacity: pressed || disabled ? 0.5 : 1 })}>
      <BlancText variant="secondary" weight="600">
        {title}
      </BlancText>
    </Pressable>
  );
}
