package gui

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/yetone/magpie/internal/provider"
	"github.com/yetone/magpie/internal/settings"
)

// #2896: Settings › Images lists the models that make videos, the one magpie
// picks when Video generation names none, and a pick magpie can't find any
// more; a save naming a model magpie doesn't know is refused and keeps the
// pick.
func TestVideoGenSettings(t *testing.T) {
	h := t.TempDir()
	t.Setenv("HOME", h)
	t.Setenv("USERPROFILE", h)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(h, ".config"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(h, ".cache"))
	// a provider of the user's whose models they said make videos; its
	// address refuses at once, and nothing here asks it
	if err := provider.Save(provider.Provider{ID: "studio", Name: "Studio", Chat: "http://127.0.0.1:1/v1", Key: "sk-studio", Models: []string{"gpt-5.5", "sora-like-2", "clip-3"}}); err != nil {
		t.Fatal(err)
	}
	for _, ref := range []string{"studio/sora-like-2", "studio/clip-3"} {
		if err := provider.SetModelKind(ref, provider.KindVideo); err != nil {
			t.Fatalf("%s: %v", ref, err)
		}
	}
	s := settingsState()
	var ids []string
	for _, m := range s.VideoGenModels {
		if m.Provider == "studio" && m.PName == "Studio" {
			ids = append(ids, m.ID)
		}
	}
	slices.Sort(ids)
	if !slices.Equal(ids, []string{"studio/clip-3", "studio/sora-like-2"}) || !slices.Contains(ids, s.VideoGenAuto) || s.VideoGenMissing != "" {
		t.Fatalf("video models %v, auto %q, missing %q", ids, s.VideoGenAuto, s.VideoGenMissing)
	}

	post := func(body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		Handler(nil, nil).ServeHTTP(rec, httptest.NewRequest("POST", "/api/settings", strings.NewReader(body)))
		return rec
	}
	if rec := post(`{"videoGen":"studio/clip-3"}`); rec.Code != http.StatusOK || settings.Load().VideoGen != "studio/clip-3" {
		t.Fatalf("picking a video model: %d %s, saved %q", rec.Code, rec.Body, settings.Load().VideoGen)
	}
	if rec := post(`{"videoGen":"nowhere/clip-9"}`); rec.Code != http.StatusBadRequest || settings.Load().VideoGen != "studio/clip-3" {
		t.Fatalf("an unknown model: %d %s, saved %q", rec.Code, rec.Body, settings.Load().VideoGen)
	}
	if rec := post(`{"videoGen":"off"}`); rec.Code != http.StatusOK || settings.Load().VideoGen != "off" {
		t.Fatalf("off: %d %s, saved %q", rec.Code, rec.Body, settings.Load().VideoGen)
	}

	// a pick saved while it was there, its provider since removed
	st := settings.Load()
	st.VideoGen = "studio/clip-3"
	if err := settings.Save(st); err != nil {
		t.Fatal(err)
	}
	if err := provider.Delete("studio"); err != nil {
		t.Fatal(err)
	}
	if s := settingsState(); s.VideoGen != "studio/clip-3" || s.VideoGenMissing != "studio/clip-3" || s.VideoGenAuto != "" {
		t.Fatalf("after removing its provider: videoGen %q, missing %q, auto %q", s.VideoGen, s.VideoGenMissing, s.VideoGenAuto)
	}
}

// A model's id is what the setting keeps: a bare name is refused, as Image
// generation's is.
func TestVideoGenIsAModelsID(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	st := settings.Load()
	st.VideoGen = "grok-imagine-video"
	if err := settings.Save(st); err == nil || !strings.Contains(err.Error(), "video generation model") {
		t.Fatalf("a bare name saved: %v", err)
	}
	for _, v := range []string{"", "off", " grok/grok-imagine-video-1.5 "} {
		st.VideoGen = v
		if err := settings.Save(st); err != nil {
			t.Fatalf("%q: %v", v, err)
		}
	}
	if got := settings.Load().VideoGen; got != "grok/grok-imagine-video-1.5" {
		t.Fatalf("saved %q", got)
	}
}
