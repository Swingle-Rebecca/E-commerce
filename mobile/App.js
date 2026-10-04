import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, FlatList, Pressable, ScrollView,
  StatusBar, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();
const API = (process.env.EXPO_PUBLIC_API_URL || 'https://beccasho.netlify.app').replace(/\/$/, '');
const KEY = 'becca-shop-session';
const RETURN_URL = 'beccashop://auth';
const money = kobo => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
const base64url = value => value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomValue = async () => {
  const bytes = await Crypto.getRandomBytesAsync(32);
  // A hex verifier has 64 URL-safe characters and 256 bits of entropy.
  return Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
};
const nonceValue = async () => base64url(await Crypto.digestStringAsync(
  Crypto.CryptoDigestAlgorithm.SHA256, await randomValue(), { encoding: Crypto.CryptoEncoding.BASE64 },
));

function Button({ title, onPress, disabled, secondary }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={[styles.button, secondary && styles.secondary, disabled && styles.disabled]}>
    <Text style={[styles.buttonText, secondary && { color: '#284b3a' }]}>{title}</Text>
  </Pressable>;
}

function Shop() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [cart, setCart] = useState({});
  const [user, setUser] = useState(null);
  const [screen, setScreen] = useState('shop');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [synced, setSynced] = useState('');
  const [shipping, setShipping] = useState({ name: '', phone: '', address: '', city: 'Port Harcourt' });
  const token = useRef(null);
  const pending = useRef(false);
  const epoch = useRef(0);
  const refreshing = useRef(false);

  async function request(path, { method = 'GET', body, auth = true } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth && token.current) headers.Authorization = 'Bearer ' + token.current;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(API + path, {
        method, headers, signal: controller.signal,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 401 && auth) {
          epoch.current++;
          token.current = null;
          setUser(null); setCart({});
          await SecureStore.deleteItemAsync(KEY);
        }
        throw new Error(data?.error || 'Request failed (' + response.status + ').');
      }
      if (data === null && path !== '/api/me') throw new Error('The shop returned an unexpected response.');
      return data;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('The shop took too long to respond. Please retry.');
      throw e;
    } finally { clearTimeout(timer); }
  }

  async function refresh() {
    if (refreshing.current || pending.current) return;
    refreshing.current = true;
    const version = epoch.current;
    try {
      const [items, groups] = await Promise.all([
        request('/api/products', { auth: false }), request('/api/categories', { auth: false }),
      ]);
      if (version !== epoch.current || pending.current) return;
      setProducts(items); setCategories(groups);
      if (token.current) {
        const [account, basket] = await Promise.all([request('/api/me'), request('/api/cart')]);
        if (version !== epoch.current || pending.current) return;
        setUser(account); setCart(basket);
        setSynced(new Date().toLocaleTimeString());
      }
      setError('');
    } catch (e) { setError(e.message); }
    finally { refreshing.current = false; setLoading(false); }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try { token.current = await SecureStore.getItemAsync(KEY); }
      catch (e) { setError('Could not restore your sign-in. Please sign in again.'); }
      if (active) await refresh();
    })();
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') refresh();
    }, 4000);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => { active = false; clearInterval(timer); subscription.remove(); };
  }, []);

  async function login() {
    if (pending.current) return;
    pending.current = true; epoch.current++; setBusy(true); setError('');
    try {
      const verifier = await randomValue();
      const challenge = base64url(await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 },
      ));
      const nonce = await nonceValue();
      const result = await WebBrowser.openAuthSessionAsync(
        API + '/auth/mobile?challenge=' + challenge + '&nonce=' + nonce, RETURN_URL,
      );
      if (result.type !== 'success') return;
      const url = new URL(result.url);
      if (url.protocol !== 'beccashop:' || url.hostname !== 'auth' ||
          url.searchParams.get('nonce') !== nonce || !url.searchParams.get('code'))
        throw new Error('Sign-in could not be verified. Please retry.');
      const { token: session } = await request('/api/mobile/session', {
        method: 'POST', auth: false, body: { code: url.searchParams.get('code'), verifier },
      });
      await SecureStore.setItemAsync(KEY, session);
      token.current = session;
      const account = await request('/api/me');
      setUser(account);
      setShipping(previous => ({ ...previous, name: account.name || '' }));
    } catch (e) { setError(e.message); }
    finally {
      pending.current = false; epoch.current++; setBusy(false);
      await refresh();
    }
  }

  async function logout() {
    if (pending.current) return;
    pending.current = true; epoch.current++; setBusy(true);
    try {
      await request('/api/mobile/logout', { method: 'POST' });
      await SecureStore.deleteItemAsync(KEY);
      token.current = null; setUser(null); setCart({}); setSynced('');
      setScreen('shop'); setError('');
    } catch (e) { setError(e.message); }
    finally { pending.current = false; epoch.current++; setBusy(false); }
  }

  async function change(id, delta) {
    if (!user) return Alert.alert('Sign in first', 'Use the same Google account as the website to share your basket.');
    if (pending.current) return;
    pending.current = true; epoch.current++; setBusy(true); setError('');
    try {
      const basket = await request('/api/cart/' + id, { method: 'POST', body: { delta } });
      setCart(basket); setSynced(new Date().toLocaleTimeString());
    } catch (e) { setError(e.message); }
    finally { pending.current = false; epoch.current++; setBusy(false); }
  }

  const lines = products.filter(product => cart[product.id]);
  const quantity = Object.values(cart).reduce((a, b) => a + b, 0);
  const subtotal = lines.reduce((total, p) => total + p.price_kobo * cart[p.id], 0);
  const filtered = products.filter(p => (!category || p.category === category) &&
    p.name.toLowerCase().includes(query.trim().toLowerCase()));

  async function checkout() {
    if (!user || pending.current) return;
    if (Object.values(shipping).some(value => !value.trim()))
      return Alert.alert('Delivery details', 'Please complete all four fields.');
    pending.current = true; epoch.current++; setBusy(true); setError('');
    try {
      const result = await request('/api/orders', { method: 'POST', body: {
        items: lines.map(p => ({ id: p.id, qty: cart[p.id] })), shipping,
      } });
      setCart({}); setScreen('shop');
      Alert.alert('Order #' + result.id + ' placed', result.emailSent ?
        'Your confirmation email has been sent.' :
        'Your order is saved. The confirmation email could not be sent.');
    } catch (e) { setError(e.message); }
    finally { pending.current = false; epoch.current++; setBusy(false); await refresh(); }
  }

  return <SafeAreaView style={styles.root}>
    <StatusBar barStyle="dark-content" backgroundColor="#faf8f2" />
    <View style={styles.header}>
      <Text style={styles.eyebrow}>PORT HARCOURT • EVERYDAY ESSENTIALS</Text>
      <Text style={styles.title}>Becca Shop</Text>
      <Text style={styles.subtitle}>Your essentials, wherever you are.</Text>
      {user ? <View style={styles.account}>
        <View style={{ flex: 1 }}><Text style={styles.bold}>{user.name}</Text>
          <Text style={styles.small}>{user.email}</Text></View>
        <Button title="Log out" onPress={logout} disabled={busy} secondary />
      </View> : <Button title={busy ? 'Signing in…' : 'Continue with Google'} onPress={login} disabled={busy} />}
    </View>
    <View style={styles.tabs}>
      <Button title="Shop" secondary={screen !== 'shop'} onPress={() => setScreen('shop')} />
      <Button title={'Basket (' + quantity + ')'} secondary={screen !== 'cart'} onPress={() => setScreen('cart')} />
    </View>
    {!!error && <View style={styles.errorBox}><Text style={styles.error}>{error}</Text>
      <Button title="Retry" onPress={refresh} disabled={busy} secondary /></View>}
    <View style={styles.sync}>
      <Text style={styles.small}>{user ? (synced ? 'Basket synced at ' + synced : 'Syncing your basket…') : 'Sign in to share your basket with the website.'}</Text>
      <Pressable onPress={refresh} disabled={busy} accessibilityRole="button"><Text style={styles.link}>Refresh</Text></Pressable>
    </View>
    {loading ? <ActivityIndicator size="large" color="#284b3a" style={{ marginTop: 40 }} /> :
      screen === 'shop' ? <>
        <TextInput style={styles.search} value={query} onChangeText={setQuery} placeholder="Search products…" accessibilityLabel="Search products" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categories} contentContainerStyle={{ gap: 8 }}>
          {[{ slug: '', name: 'All' }, ...categories].map(c => <Pressable key={c.slug}
            onPress={() => setCategory(c.slug)} style={[styles.chip, category === c.slug && styles.selected]}>
            <Text style={category === c.slug ? { color: 'white' } : { color: '#284b3a' }}>{c.name}</Text>
          </Pressable>)}
        </ScrollView>
        <FlatList data={filtered} keyExtractor={p => String(p.id)} contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.subtitle}>No products found.</Text>}
          renderItem={({ item: p }) => <View style={styles.card}>
            <Text style={styles.emoji}>{p.emoji}</Text>
            <View style={{ flex: 1, gap: 6 }}><Text style={styles.productName}>{p.name}</Text>
              <Text style={styles.small}>{p.description}</Text>
              <Text style={styles.price}>{money(p.price_kobo)}</Text>
              <Button title={p.stock ? 'Add to basket' : 'Sold out'} disabled={busy || !p.stock || (cart[p.id] || 0) >= 20}
                onPress={() => change(p.id, 1)} /></View>
          </View>} />
      </> : <ScrollView contentContainerStyle={styles.list}>
        <Text style={styles.section}>Your basket</Text>
        {!lines.length && <Text style={styles.subtitle}>Your basket is empty. Add something you love.</Text>}
        {lines.map(p => <View key={p.id} style={styles.card}>
          <Text style={styles.emoji}>{p.emoji}</Text>
          <View style={{ flex: 1, gap: 8 }}><Text style={styles.productName}>{p.name}</Text>
            <Text style={styles.price}>{money(p.price_kobo * cart[p.id])}</Text>
            <View style={styles.quantity}>
              <Button title="−" onPress={() => change(p.id, -1)} disabled={busy} secondary />
              <Text style={styles.bold}>{cart[p.id]}</Text>
              <Button title="+" onPress={() => change(p.id, 1)} disabled={busy || cart[p.id] >= Math.min(20, p.stock)} secondary />
            </View>
          </View>
        </View>)}
        {!!lines.length && <View style={styles.summary}>
          <Text style={styles.bold}>Subtotal: {money(subtotal)}</Text>
          <Text style={styles.small}>Delivery: {money(400000)}</Text>
          <Text style={styles.section}>Total: {money(subtotal + 400000)}</Text>
          <Text style={styles.bold}>Delivery details</Text>
          {['name', 'phone', 'address', 'city'].map(field => <TextInput key={field}
            accessibilityLabel={field} placeholder={field[0].toUpperCase() + field.slice(1)}
            value={shipping[field]} keyboardType={field === 'phone' ? 'phone-pad' : 'default'}
            style={styles.search} onChangeText={value => setShipping(previous => ({ ...previous, [field]: value }))} />)}
          <Button title={busy ? 'Please wait…' : 'Place order'} onPress={checkout} disabled={busy} />
          <Text style={styles.small}>No online payment is collected. The shop will arrange payment and delivery.</Text>
        </View>}
      </ScrollView>}
  </SafeAreaView>;
}

export default function App() {
  return <SafeAreaProvider><Shop /></SafeAreaProvider>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#faf8f2' },
  header: { padding: 20, gap: 12 },
  eyebrow: { fontSize: 10, letterSpacing: 1.5, color: '#7d8069', fontWeight: '700' },
  title: { fontSize: 34, color: '#284b3a', fontWeight: '800' },
  subtitle: { color: '#6d756b', fontSize: 14 },
  account: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tabs: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingBottom: 10 },
  button: { backgroundColor: '#284b3a', borderRadius: 12, paddingHorizontal: 18, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  secondary: { backgroundColor: '#e7ebdf' },
  disabled: { opacity: 0.45 },
  small: { color: '#6d756b', fontSize: 12, lineHeight: 18 },
  bold: { color: '#284b3a', fontWeight: '700' },
  link: { color: '#284b3a', fontWeight: '700', padding: 8 },
  search: { backgroundColor: 'white', borderWidth: 1, borderColor: '#e1e2d9', borderRadius: 12, padding: 14, marginHorizontal: 20, marginBottom: 12 },
  categories: { flexGrow: 0, marginHorizontal: 20, marginBottom: 14, maxHeight: 44 },
  chip: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 24, backgroundColor: '#e7ebdf' },
  selected: { backgroundColor: '#284b3a' },
  list: { padding: 20, gap: 14, paddingBottom: 40 },
  card: { backgroundColor: 'white', borderRadius: 18, padding: 18, flexDirection: 'row', gap: 16, borderColor: '#e9e7de', borderWidth: 1 },
  emoji: { fontSize: 44, width: 62, textAlign: 'center' },
  productName: { fontWeight: '700', fontSize: 17, color: '#293b2e' },
  price: { fontSize: 18, color: '#284b3a', fontWeight: '800' },
  quantity: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  summary: { backgroundColor: '#eef0e6', padding: 18, borderRadius: 18, gap: 14 },
  section: { fontSize: 22, color: '#284b3a', fontWeight: '800' },
  sync: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 20, marginBottom: 12, gap: 8 },
  errorBox: { marginHorizontal: 20, backgroundColor: '#fff0eb', padding: 12, borderRadius: 12, gap: 8 },
  error: { color: '#9b3629' },
});
