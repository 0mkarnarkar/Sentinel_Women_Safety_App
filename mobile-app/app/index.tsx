import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Vibration, Animated, Dimensions, TextInput, Alert, ActivityIndicator, FlatList, Keyboard, Switch, Image } from 'react-native';
import { Accelerometer } from 'expo-sensors';
import * as Location from 'expo-location';
import { Audio } from 'expo-av'; 
import * as Notifications from 'expo-notifications'; 
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, Circle } from 'react-native-maps';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

const SCREEN_WIDTH = Dimensions.get('window').width;

// ⚠️ IMPORTANT: Verify this is your laptop's current IP address!
const BACKEND_URL = 'http://<replace with your laptops current IP address>:8000'; 

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
});

export default function App() {
  const [currentScreen, setCurrentScreen] = useState('home'); 
  const [menuOpen, setMenuOpen] = useState(false);
  
  // AUTHENTICATION
  const [authMode, setAuthMode] = useState('login'); 
  const [loginInput, setLoginInput] = useState(''); 
  const [loginPassword, setLoginPassword] = useState('');
  const [signupData, setSignupData] = useState({ name: '', email: '', password: '', gender: '' });
  const [registeredUser, setRegisteredUser] = useState(null); 
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // MAP
  const mapRef = useRef(null);
  const [location, setLocation] = useState(null);
  const [destination, setDestination] = useState('');
  const [suggestions, setSuggestions] = useState([]); 
  const [sosActive, setSosActive] = useState(false);
  const [routes, setRoutes] = useState([]); 
  const [safeZones, setSafeZones] = useState([]); 
  const [isSearching, setIsSearching] = useState(false);

  // AUDIO PIPELINE
  const [sentinelMode, setSentinelMode] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("Listening for keywords...");
  const [audioLogs, setAudioLogs] = useState([]); 
  const recordingRef = useRef(null);
  const isSentinelActive = useRef(false);

  const sidebarAnim = useRef(new Animated.Value(-SCREEN_WIDTH)).current;
  const floatAnim = useRef(new Animated.Value(0)).current;
  const bgPulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(floatAnim, { toValue: -8, duration: 2000, useNativeDriver: true }),
      Animated.timing(floatAnim, { toValue: 8, duration: 2000, useNativeDriver: true })
    ])).start();
    initializeHardware();
  }, []);

  // SMOOTH RED SCREEN TRANSITION
  useEffect(() => {
    if (sosActive) {
      Animated.timing(bgPulseAnim, { toValue: 1, duration: 400, useNativeDriver: false }).start();
    } else {
      Animated.timing(bgPulseAnim, { toValue: 0, duration: 400, useNativeDriver: false }).start();
    }
  }, [sosActive]);

  const interpolatedBg = bgPulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#FDF2F8', '#9F1239'] // Fades from soft Blush Pink to Deep Crimson
  });

  useEffect(() => {
    isSentinelActive.current = sentinelMode;
    if (sentinelMode) {
      activateKeepAwakeAsync();
      startContinuousAudioLoop();
    } else {
      deactivateKeepAwake();
      stopRecordingGracefully();
      setLiveTranscript("System Disarmed");
    }
  }, [sentinelMode]);

  const initializeHardware = async () => {
    await Notifications.requestPermissionsAsync();
    let { status: locStatus } = await Location.requestForegroundPermissionsAsync();
    if (locStatus === 'granted') {
      let loc = await Location.getCurrentPositionAsync({});
      setLocation(loc.coords);
      Location.watchPositionAsync({ accuracy: Location.Accuracy.High, distanceInterval: 5 }, (res) => setLocation(res.coords));
    }
    await Audio.requestPermissionsAsync();

    Accelerometer.setUpdateInterval(100);
    Accelerometer.addListener(({ x, y, z }) => {
      const gForce = Math.sqrt(x*x + y*y + z*z);
      const threshold = isSentinelActive.current ? 2.5 : 5.0; 
      if (gForce > threshold && !sosActive) triggerEmergency("Hardware: Phone Dropped/Impact");
    });
  };

  const startContinuousAudioLoop = async () => {
    if (!isSentinelActive.current || sosActive) return;
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync({
        isMeteringEnabled: true,
        android: { extension: '.wav', outputFormat: Audio.RECORDING_OPTION_ANDROID_OUTPUT_FORMAT_DEFAULT, audioEncoder: Audio.RECORDING_OPTION_ANDROID_AUDIO_ENCODER_DEFAULT },
        ios: { extension: '.wav', audioQuality: Audio.RECORDING_OPTION_IOS_AUDIO_QUALITY_HIGH, sampleRate: 44100, numberOfChannels: 1, bitRate: 128000, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false }
      });
      
      recordingRef.current = recording;
      setLiveTranscript("Recording chunk...");

      setTimeout(async () => {
        if (isSentinelActive.current && recordingRef.current) {
          await recordingRef.current.stopAndUnloadAsync();
          const uri = recordingRef.current.getURI();
          analyzeAudioWithPython(uri);
          startContinuousAudioLoop(); 
        }
      }, 4000);
    } catch (err) {}
  };

  const analyzeAudioWithPython = async (uri) => {
    let formData = new FormData();
    formData.append('file', { uri: uri, type: 'audio/wav', name: 'audio.wav' });

    try {
      let res = await fetch(`${BACKEND_URL}/api/v1/sos/analyze-audio`, {
        method: 'POST', body: formData, headers: { 'Content-Type': 'multipart/form-data' }
      });
      let json = await res.json();
      
      if (json.transcript && json.transcript !== "[Silence or unreadable]") {
        setLiveTranscript(json.transcript);
        setAudioLogs(prev => [{ id: Date.now().toString(), uri, date: new Date().toLocaleTimeString(), text: json.transcript }, ...prev]);
      } else {
        setLiveTranscript("Listening...");
      }

      if (json.danger_detected) triggerEmergency(`Voice NLP: Heard "${json.transcript}"`);
    } catch (e) {
      setLiveTranscript("Network Error: Cannot reach Python Server");
    }
  };

  const stopRecordingGracefully = async () => {
    if (recordingRef.current) {
      try { await recordingRef.current.stopAndUnloadAsync(); recordingRef.current = null; } catch(e) {}
    }
  };

  const playAudio = async (uri) => {
    try { const { sound } = await Audio.Sound.createAsync({ uri }); await sound.playAsync(); } catch (e) { Alert.alert("Error", "Could not play audio snippet."); }
  };

  const triggerEmergency = async (reason) => {
    if (sosActive) return;
    setSosActive(true);
    setSentinelMode(false); 
    setCurrentScreen('home'); 
    Vibration.vibrate([500, 500, 500, 500, 500], true);
    
    await Notifications.scheduleNotificationAsync({
      content: { title: "🚨 SENTINEL SOS ACTIVE", body: `Triggered by: ${reason}`, sound: 'default', color: '#E11D48' },
      trigger: null, 
    });

    try {
      await fetch(`${BACKEND_URL}/api/v1/sos/trigger`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: isLoggedIn && registeredUser ? registeredUser.name : "guest", trigger_type: reason, lat: location?.latitude || 0, lng: location?.longitude || 0 })
      });
    } catch (e) {}
  };

  const toggleMenu = () => { Animated.timing(sidebarAnim, { toValue: menuOpen ? -SCREEN_WIDTH : 0, duration: 300, useNativeDriver: true }).start(); setMenuOpen(!menuOpen); };

  const fetchSuggestions = async (text) => {
    setDestination(text); if (text.length < 3) { setSuggestions([]); return; }
    try { const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${text}&limit=4`); const data = await res.json(); setSuggestions(data); } catch (e) {}
  };
  const clearSearch = () => { setDestination(''); setSuggestions([]); Keyboard.dismiss(); };
  const cancelRoute = () => { setRoutes([]); setSafeZones([]); setDestination(''); setSuggestions([]); if (mapRef.current && location) { mapRef.current.animateToRegion({ latitude: location.latitude, longitude: location.longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 1000); } };

  const calculateMultiRoutes = async (destItem) => {
    Keyboard.dismiss(); setDestination(destItem.display_name); setSuggestions([]); setRoutes([]); setSafeZones([]); setIsSearching(true);
    const dLat = parseFloat(destItem.lat); const dLon = parseFloat(destItem.lon);
    try {
      const routeRes = await fetch(`http://router.project-osrm.org/route/v1/foot/${location.longitude},${location.latitude};${dLon},${dLat}?overview=full&geometries=geojson&alternatives=3`);
      const routeData = await routeRes.json();
      if (routeData.routes && routeData.routes.length > 0) {
        const formattedRoutes = routeData.routes.map((r, index) => ({ id: index, coords: r.geometry.coordinates.map(c => ({ latitude: c[1], longitude: c[0] })), isSafest: index === 0 }));
        setRoutes(formattedRoutes);
        if (mapRef.current) mapRef.current.fitToCoordinates(formattedRoutes[0].coords, { edgePadding: { top: 150, right: 50, bottom: 150, left: 50 }, animated: true });
      }
      try {
        const midLat = (location.latitude + dLat) / 2; const midLon = (location.longitude + dLon) / 2;
        const overpassQuery = `[out:json];node(around:1500,${midLat},${midLon})["amenity"~"cafe|restaurant|bank|police|mall"];out 15;`;
        const zoneRes = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`);
        const zoneData = await zoneRes.json();
        if (zoneData.elements) setSafeZones(zoneData.elements.map(e => ({ id: e.id.toString(), latitude: e.lat, longitude: e.lon, name: e.tags.name || "Safe Area" })));
      } catch (zoneErr) {}
    } catch (e) {}
    setIsSearching(false);
  };

  const handleAuthSubmit = () => {
    if (authMode === 'signup') {
      if (!signupData.name || !signupData.email || !signupData.password) return Alert.alert("Missing Fields", "Please fill in your details.");
      setRegisteredUser({ ...signupData });
      setAuthMode('login');
      Alert.alert("Account Created", "Welcome to Sentinel! Please log in.");
      setSignupData({ name: '', email: '', password: '', gender: '' });
    } else {
      if (!registeredUser) return Alert.alert("No Account Found", "Please sign up first.");
      const isMatch = (loginInput.toLowerCase() === registeredUser.name.toLowerCase() || loginInput.toLowerCase() === registeredUser.email.toLowerCase()) && loginPassword === registeredUser.password;
      if (isMatch) {
        setIsLoggedIn(true); setCurrentScreen('home'); toggleMenu(); setLoginInput(''); setLoginPassword('');
      } else { Alert.alert("Access Denied", "Incorrect credentials."); }
    }
  };

  const handleLogout = () => { setIsLoggedIn(false); toggleMenu(); Alert.alert("Logged Out", "You have been securely signed out."); };

  return (
    <View style={styles.container}>
      
      {/* GLOBAL HEADER */}
      {currentScreen !== 'map' && (
        <View style={[styles.header, sosActive && { backgroundColor: '#7F1D1D', borderBottomColor: '#7F1D1D' }]}>
          <TouchableOpacity onPress={toggleMenu} style={styles.menuIconBox}>
            <Ionicons name="menu" size={30} color={sosActive ? "#FFF" : "#E11D48"} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, sosActive && { color: '#FFF' }]}>
            {currentScreen === 'logs' ? 'EVIDENCE' : currentScreen === 'auth' ? 'ACCOUNT' : 'SENTINEL'}
          </Text>
          
          {/* CUSTOM JPEG LOGO (CIRCULAR BADGE) */}
          <TouchableOpacity onPress={() => setCurrentScreen('home')} style={styles.menuIconBox}>
            <Image 
              source={require('../assets/logo.jpeg')} 
              style={{ 
                width: 38, 
                height: 38, 
                borderRadius: 19, 
                borderWidth: 2, 
                borderColor: sosActive ? '#FFF' : '#FDA4AF', 
                resizeMode: 'cover' 
              }} 
            />
          </TouchableOpacity>
        </View>
      )}

      {/* SOS DASHBOARD */}
      {currentScreen === 'home' && (
        <Animated.View style={[styles.centerStage, { backgroundColor: interpolatedBg }]}>
            <Animated.View style={{ transform: [{ translateY: floatAnim }], zIndex: 2 }}>
              <TouchableOpacity onLongPress={() => triggerEmergency("Manual Dashboard SOS")} style={[styles.sosButton, sosActive && {backgroundColor: '#E11D48', shadowColor: '#000', elevation: 25}]}>
                <View style={[styles.sosInner, sosActive && {backgroundColor: '#FFF', borderColor: '#FFF'}]}>
                  <Text style={[styles.sosText, sosActive && {color: '#BE123C'}]}>{sosActive ? "SENT" : "SOS"}</Text>
                </View>
              </TouchableOpacity>
            </Animated.View>
            
          <Text style={[styles.statusText, sosActive && { color: '#FFF', fontSize: 16, letterSpacing: 2 }]}>
            {sosActive ? "EMERGENCY BROADCAST LIVE" : "HOLD TO TRIGGER"}
          </Text>
          
          {sentinelMode && !sosActive && (
            <View style={styles.nlpDemoContainer}>
                <View style={styles.sentinelActiveBadge}>
                    <View style={styles.pulsingDot} />
                    <Text style={{color: '#E11D48', fontWeight: '800', marginLeft: 10, fontSize: 13, letterSpacing: 0.5}}>SENSORS ARMED & LISTENING</Text>
                </View>
                <View style={styles.transcriptBox}>
                    <Text style={{fontSize: 10, color: '#F87171', marginBottom: 5, fontWeight: 'bold', letterSpacing: 1}}>LIVE NLP TRANSCRIPT</Text>
                    <Text style={styles.transcriptText}>"{liveTranscript}"</Text>
                </View>
            </View>
          )}

          {sosActive && (
            <TouchableOpacity onPress={() => {setSosActive(false); Vibration.cancel();}} style={styles.cancelSOSBtn}>
              <Ionicons name="close-circle" size={20} color="#FFF" style={{marginRight: 8}} />
              <Text style={{color: '#FFF', fontWeight: '900', letterSpacing: 1}}>DISARM SYSTEM</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      )}

      {/* MAP SCREEN */}
      {currentScreen === 'map' && (
        <View style={{flex: 1}}>
          <View style={styles.searchOverlay}>
            <TouchableOpacity onPress={toggleMenu} style={styles.menuIconOverlay}>
              <Ionicons name="menu" size={28} color="#E11D48" />
            </TouchableOpacity>
            <TextInput style={styles.searchInput} placeholder="Search Destination..." value={destination} onChangeText={fetchSuggestions} placeholderTextColor="#FCA5A5"/>
            {destination.length > 0 && !isSearching && <TouchableOpacity onPress={clearSearch} style={styles.clearIconOverlay}><Ionicons name="close-circle" size={22} color="#FDA4AF" /></TouchableOpacity>}
            {isSearching && <ActivityIndicator style={styles.clearIconOverlay} color="#E11D48" />}
          </View>
          
          {suggestions.length > 0 && (
            <View style={styles.suggestionsBox}>
              <FlatList data={suggestions} keyExtractor={(item) => item.place_id.toString()} renderItem={({item}) => (
                <TouchableOpacity style={styles.suggestionItem} onPress={() => calculateMultiRoutes(item)}>
                  <Ionicons name="location" size={20} color="#FDA4AF" style={{marginRight: 10}} />
                  <Text numberOfLines={1} style={{flex: 1, color: '#1F2937', fontWeight: '500'}}>{item.display_name}</Text>
                </TouchableOpacity>
              )} />
            </View>
          )}

          <View style={styles.sentinelToggleContainer}>
            <View>
              <Text style={{fontWeight: '900', color: '#BE123C'}}>Sentinel Mode</Text>
              <Text style={{fontSize: 10, color: sentinelMode ? '#E11D48' : '#FCA5A5', fontWeight: '600'}}>{sentinelMode ? '🔴 Active: NLP & Drop' : 'Keeps screen awake'}</Text>
            </View>
            <Switch trackColor={{ false: "#FCE7F3", true: "#FDA4AF" }} thumbColor={sentinelMode ? "#E11D48" : "#FFF"} onValueChange={() => setSentinelMode(!sentinelMode)} value={sentinelMode} />
          </View>

          {routes.length > 0 && (
            <View style={styles.bottomControls}>
              <TouchableOpacity style={styles.endRouteBtn} onPress={cancelRoute}>
                <Ionicons name="close" size={22} color="#FFF" />
                <Text style={{color: '#FFF', fontWeight: '800', marginLeft: 8, letterSpacing: 1}}>END ROUTE</Text>
              </TouchableOpacity>
            </View>
          )}

          {location && (
            <MapView ref={mapRef} style={styles.map} provider={PROVIDER_DEFAULT} initialRegion={{ latitude: location.latitude, longitude: location.longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 }} showsUserLocation={true}>
              {[...routes].reverse().map(route => (
                <Polyline key={route.id} coordinates={route.coords} strokeWidth={route.isSafest ? 7 : 4} strokeColor={route.isSafest ? "#E11D48" : "#FBCFE8"} />
              ))}
              {safeZones.map(zone => (
                <View key={zone.id}>
                  <Marker coordinate={{latitude: zone.latitude, longitude: zone.longitude}} pinColor="#10B981" />
                  <Circle center={{latitude: zone.latitude, longitude: zone.longitude}} radius={80} fillColor="rgba(16, 185, 129, 0.2)" strokeColor="rgba(16, 185, 129, 0.5)" />
                </View>
              ))}
            </MapView>
          )}
        </View>
      )}

      {/* EVIDENCE VAULT SCREEN */}
      {currentScreen === 'logs' && (
        <View style={styles.logsContainer}>
          <Text style={styles.logsSubtitle}>Local Audio Snippets stored during Sentinel Mode</Text>
          {audioLogs.length === 0 ? (
            <View style={{alignItems: 'center', marginTop: 80}}>
              <Ionicons name="mic-off-outline" size={60} color="#FCE7F3" />
              <Text style={{marginTop: 15, color: '#FDA4AF', fontWeight: 'bold', fontSize: 16}}>No speech recorded yet.</Text>
            </View>
          ) : (
            <FlatList data={audioLogs} keyExtractor={item => item.id} renderItem={({item}) => (
              <View style={styles.logItem}>
                <View style={{flex: 1, marginRight: 15}}>
                  <Text style={{fontWeight: '900', color: '#BE123C', fontSize: 15}}>Audio Snippet</Text>
                  <Text style={{color: '#F87171', fontSize: 11, marginBottom: 8, fontWeight: 'bold'}}>{item.date}</Text>
                  <Text style={{color: '#1F2937', fontSize: 14, fontStyle: 'italic'}} numberOfLines={2}>
                    "{item.text}"
                  </Text>
                </View>
                <TouchableOpacity onPress={() => playAudio(item.uri)} style={styles.playBtn}>
                  <Ionicons name="play" size={20} color="#FFF" />
                </TouchableOpacity>
              </View>
            )} />
          )}
        </View>
      )}

      {/* AUTHENTICATION SCREEN */}
      {currentScreen === 'auth' && (
        <View style={styles.authContainer}>
          <Text style={styles.authTitle}>{authMode === 'login' ? 'WELCOME BACK' : 'CREATE ACCOUNT'}</Text>
          
          {authMode === 'signup' ? (
            <>
              <Text style={styles.label}>FULL NAME</Text>
              <TextInput style={styles.input} placeholder="e.g., Jane Doe" placeholderTextColor="#FCA5A5" value={signupData.name} onChangeText={(t) => setSignupData({...signupData, name: t})} />
              <Text style={styles.label}>EMAIL ADDRESS</Text>
              <TextInput style={styles.input} placeholder="e.g., jane@example.com" placeholderTextColor="#FCA5A5" value={signupData.email} onChangeText={(t) => setSignupData({...signupData, email: t})} keyboardType="email-address" autoCapitalize="none" />
              <Text style={styles.label}>GENDER (Optional)</Text>
              <TextInput style={styles.input} placeholder="e.g., Female, Male, Non-Binary" placeholderTextColor="#FCA5A5" value={signupData.gender} onChangeText={(t) => setSignupData({...signupData, gender: t})} />
              <Text style={styles.label}>CREATE PASSWORD</Text>
              <TextInput style={styles.input} placeholder="••••••••" placeholderTextColor="#FCA5A5" secureTextEntry value={signupData.password} onChangeText={(t) => setSignupData({...signupData, password: t})} />
            </>
          ) : (
            <>
              <Text style={styles.label}>USERNAME OR EMAIL</Text>
              <TextInput style={styles.input} placeholder="Enter Name or Email" placeholderTextColor="#FCA5A5" value={loginInput} onChangeText={setLoginInput} autoCapitalize="none" />
              <Text style={styles.label}>PASSWORD</Text>
              <TextInput style={styles.input} placeholder="••••••••" placeholderTextColor="#FCA5A5" secureTextEntry value={loginPassword} onChangeText={setLoginPassword} />
            </>
          )}
          <TouchableOpacity style={styles.submitBtn} onPress={handleAuthSubmit}><Text style={styles.submitBtnText}>{authMode === 'login' ? 'LOG IN' : 'SIGN UP'}</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}><Text style={styles.switchAuthText}>{authMode === 'login' ? "Don't have an account? Sign Up" : "Already have an account? Log In"}</Text></TouchableOpacity>
        </View>
      )}

      {/* SIDEBAR */}
      <Animated.View style={[styles.sidebar, { transform: [{ translateX: sidebarAnim }] }]}>
        <View style={styles.sidebarContent}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={45} color="#E11D48" />
          </View>
          <Text style={{textAlign: 'center', fontWeight: '900', fontSize: 20, marginBottom: 5, color: '#BE123C'}}>{isLoggedIn && registeredUser ? registeredUser.name : 'Guest User'}</Text>
          <Text style={{textAlign: 'center', color: '#F87171', fontSize: 12, marginBottom: 35, fontWeight: 'bold'}}>{isLoggedIn && registeredUser ? registeredUser.email : 'Please log in to save data'}</Text>

          <TouchableOpacity style={styles.menuItem} onPress={() => {setCurrentScreen('home'); toggleMenu();}}>
            <View style={styles.menuIconBg}><Ionicons name="shield" size={20} color="#E11D48" /></View>
            <Text style={styles.menuText}>SOS Dashboard</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} onPress={() => {setCurrentScreen('map'); toggleMenu();}}>
            <View style={styles.menuIconBg}><Ionicons name="map" size={20} color="#E11D48" /></View>
            <Text style={styles.menuText}>Find Safe Route</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} onPress={() => {setCurrentScreen('logs'); toggleMenu();}}>
            <View style={styles.menuIconBg}><Ionicons name="mic" size={20} color="#E11D48" /></View>
            <Text style={styles.menuText}>Audio Vault</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.menuItem, {marginTop: 'auto', borderBottomWidth: 0}]} onPress={() => { isLoggedIn ? handleLogout() : (setCurrentScreen('auth') || toggleMenu()); }}>
            <View style={[styles.menuIconBg, {backgroundColor: isLoggedIn ? '#F3F4F6' : '#FFF1F2'}]}>
              <Ionicons name={isLoggedIn ? "log-out" : "log-in"} size={20} color={isLoggedIn ? "#9CA3AF" : "#E11D48"} />
            </View>
            <Text style={[styles.menuText, {color: isLoggedIn ? '#9CA3AF' : '#1F2937'}]}>{isLoggedIn ? 'Sign Out' : 'Login / Sign Up'}</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}

// 🎨 BEAUTIFUL BLUSH PINK THEME 
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FDF2F8' },
  header: { height: 110, paddingTop: 45, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, backgroundColor: '#FDF2F8', borderBottomWidth: 1, borderBottomColor: '#FCE7F3', elevation: 2, shadowColor: '#FDA4AF', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8 },
  headerTitle: { color: '#E11D48', fontSize: 22, fontWeight: '900', letterSpacing: 3 },
  menuIconBox: { padding: 5 },

  centerStage: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  
  sosButton: { width: 230, height: 230, borderRadius: 115, backgroundColor: '#FCE7F3', justifyContent: 'center', alignItems: 'center', elevation: 15, shadowColor: '#E11D48', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.25, shadowRadius: 20 },
  sosInner: { width: 170, height: 170, borderRadius: 85, backgroundColor: '#E11D48', justifyContent: 'center', alignItems: 'center', elevation: 8, shadowColor: '#9F1239', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.3, shadowRadius: 10, borderWidth: 3, borderColor: '#FDA4AF' },
  sosText: { color: '#FFF', fontSize: 45, fontWeight: '900', letterSpacing: 2 },
  statusText: { marginTop: 35, color: '#FDA4AF', fontWeight: '800', letterSpacing: 1.5, fontSize: 12 },
  
  nlpDemoContainer: { alignItems: 'center', marginTop: 20, width: '85%' },
  sentinelActiveBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 25, borderWidth: 1.5, borderColor: '#FDA4AF', marginBottom: 15, elevation: 2, shadowColor: '#E11D48', shadowOpacity: 0.1, shadowRadius: 5 },
  pulsingDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#E11D48' },
  transcriptBox: { width: '100%', minHeight: 80, backgroundColor: '#FFF', borderWidth: 2, borderColor: '#FCE7F3', borderRadius: 16, padding: 18, justifyContent: 'center', alignItems: 'center', elevation: 4, shadowColor: '#FDA4AF', shadowOpacity: 0.15, shadowRadius: 10 },
  transcriptText: { color: '#BE123C', fontSize: 16, fontStyle: 'italic', textAlign: 'center', fontWeight: '800' },
  cancelSOSBtn: { flexDirection: 'row', alignItems: 'center', marginTop: 40, paddingHorizontal: 25, paddingVertical: 15, backgroundColor: 'transparent', borderWidth: 2, borderColor: '#FFF', borderRadius: 30, zIndex: 2 },
  
  map: { flex: 1 },
  searchOverlay: { position: 'absolute', top: 55, left: 20, right: 20, zIndex: 10, flexDirection: 'row', backgroundColor: '#FFF', borderRadius: 25, elevation: 12, shadowColor: '#E11D48', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.15, shadowRadius: 12, alignItems: 'center', height: 55, borderWidth: 1, borderColor: '#FCE7F3' },
  menuIconOverlay: { paddingHorizontal: 15 },
  searchInput: { flex: 1, height: '100%', fontSize: 16, color: '#1F2937', fontWeight: '600' },
  clearIconOverlay: { paddingHorizontal: 15 },
  suggestionsBox: { position: 'absolute', top: 120, left: 20, right: 20, zIndex: 20, backgroundColor: '#FFF', borderRadius: 15, elevation: 15, shadowColor: '#E11D48', shadowOpacity: 0.1, shadowRadius: 15, maxHeight: 250, borderWidth: 1, borderColor: '#FCE7F3' },
  suggestionItem: { padding: 18, borderBottomWidth: 1, borderColor: '#FFF1F2', flexDirection: 'row', alignItems: 'center' },
  sentinelToggleContainer: { position: 'absolute', top: 125, right: 20, zIndex: 5, backgroundColor: '#FFF', paddingHorizontal: 15, paddingVertical: 12, borderRadius: 15, elevation: 8, shadowColor: '#E11D48', shadowOpacity: 0.15, shadowRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#FCE7F3' },
  bottomControls: { position: 'absolute', bottom: 40, left: 0, right: 0, zIndex: 5, alignItems: 'center' },
  endRouteBtn: { flexDirection: 'row', backgroundColor: '#E11D48', paddingHorizontal: 30, paddingVertical: 15, borderRadius: 30, elevation: 10, shadowColor: '#BE123C', shadowOpacity: 0.3, shadowRadius: 10, alignItems: 'center', borderWidth: 2, borderColor: '#FDA4AF' },
  
  logsContainer: { flex: 1, padding: 25, backgroundColor: '#FDF2F8' },
  logsSubtitle: { color: '#F87171', marginBottom: 25, fontWeight: 'bold', fontSize: 12, letterSpacing: 0.5 },
  logItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FFF', padding: 18, borderRadius: 16, marginBottom: 15, elevation: 5, shadowColor: '#FDA4AF', shadowOpacity: 0.15, shadowRadius: 8, borderWidth: 1, borderColor: '#FCE7F3' },
  playBtn: { backgroundColor: '#E11D48', width: 45, height: 45, borderRadius: 22.5, justifyContent: 'center', alignItems: 'center', elevation: 4, shadowColor: '#BE123C', shadowOpacity: 0.3, shadowRadius: 5 },

  authContainer: { flex: 1, padding: 35, justifyContent: 'center', backgroundColor: '#FDF2F8' },
  authTitle: { fontSize: 26, fontWeight: '900', color: '#E11D48', marginBottom: 40, textAlign: 'center', letterSpacing: 2 },
  label: { fontSize: 11, fontWeight: '900', color: '#FDA4AF', marginBottom: 8, marginLeft: 5, letterSpacing: 1 },
  input: { width: '100%', height: 60, backgroundColor: '#FFF', borderRadius: 15, paddingHorizontal: 20, marginBottom: 25, borderWidth: 2, borderColor: '#FCE7F3', fontSize: 16, color: '#1F2937', elevation: 2, shadowColor: '#FDA4AF', shadowOpacity: 0.05, shadowRadius: 5 },
  submitBtn: { width: '100%', height: 60, backgroundColor: '#E11D48', borderRadius: 15, justifyContent: 'center', alignItems: 'center', marginTop: 15, elevation: 8, shadowColor: '#BE123C', shadowOpacity: 0.3, shadowRadius: 10 },
  submitBtnText: { color: '#FFF', fontWeight: '900', fontSize: 17, letterSpacing: 1.5 },
  switchAuthText: { marginTop: 30, color: '#F87171', textAlign: 'center', fontWeight: 'bold', fontSize: 14 },

  sidebar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: SCREEN_WIDTH * 0.78, backgroundColor: '#FFF', zIndex: 100, elevation: 30, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 20 },
  sidebarContent: { flex: 1, padding: 30, paddingTop: 70 },
  avatar: { width: 90, height: 90, borderRadius: 45, backgroundColor: '#FFF1F2', alignSelf: 'center', justifyContent: 'center', alignItems: 'center', marginBottom: 15, borderWidth: 2, borderColor: '#FDA4AF' },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 20, borderBottomWidth: 1, borderColor: '#FCE7F3' },
  menuIconBg: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#FFF1F2', justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  menuText: { fontSize: 17, color: '#1F2937', fontWeight: '800' }
});
