// nights-nx-installer (2026-11-22, the user: "rencode video and audio to opus and h265"; culdcept-nx-installer's
// wasm/src/wmv3/wmv3_wasm.c of 2026-11-20, credit it): FFmpeg's VC-1 and WMV3 decoders in WebAssembly (wasm/vc1.mjs,
// built by wasm/src/vc1/build.sh from the FFmpeg 4.4 of nights-nx's sdk/thirdparty/FFmpeg). NiGHTS's movies are VC-1
// advanced profile (WVC1) with B pictures, where Culdcept's are WMV3 without. lib/movies.js feeds it a movie's frames as
// the ASF file holds them and takes the picture the game's decoder shows after each one (nights-nx's
// app/src/nights_wmv_ffmpeg.cpp, checked on the PC against the game's decoder picture for picture): the newest picture
// the decoder has given, and at the movie's first frame that frame's own picture (drained from a decoder of its own).
//
//   vc1_open(extradata, size, width, height) -> 0 VC-1 / 1 WMV3 / < 0   the stream's sequence header (the ASF codec
//                                                                        data); VC-1 when it holds a sequence header
//                                                                        start code (00 00 01 0F)
//   vc1_decode(data, size) -> pictures given (0 or more) / < 0         one frame's payload; the newest is the picture
//   vc1_first(data, size) -> 1 / 0 / < 0                              a first frame alone, drained: its picture
//   vc1_picture() -> pointer to width * height * 3 / 2 bytes            the picture, I420 (Y, U, V, no padding)
//   vc1_close(); vc1_malloc(n); vc1_free(p); vc1_version()
#include <emscripten/emscripten.h>
#include <stdlib.h>
#include <string.h>

#include <libavcodec/avcodec.h>
#include <libavutil/frame.h>
#include <libavutil/mem.h>

extern AVCodec ff_vc1_decoder;
extern AVCodec ff_wmv3_decoder;

static AVCodecContext *ctx;
static AVPacket *pkt;
static AVFrame *frame;
static uint8_t *i420;
static uint8_t *seq_copy;
static int seq_size;
static int width, height, is_vc1;

EMSCRIPTEN_KEEPALIVE void vc1_close(void) {
  if (ctx) avcodec_free_context(&ctx);
  if (pkt) av_packet_free(&pkt);
  if (frame) av_frame_free(&frame);
  free(i420);
  i420 = NULL;
  free(seq_copy);
  seq_copy = NULL;
  seq_size = 0;
}

static AVCodecContext *open_context(void) {
  AVCodec *codec = is_vc1 ? &ff_vc1_decoder : &ff_wmv3_decoder;
  AVCodecContext *c = avcodec_alloc_context3(codec);
  if (!c) return NULL;
  c->width = c->coded_width = width;
  c->height = c->coded_height = height;
  if (!is_vc1) c->flags |= AV_CODEC_FLAG_LOW_DELAY;  // WMV3 without B pictures (Culdcept's)
  c->thread_count = 1;
  if (seq_size > 0) {
    c->extradata = av_mallocz(seq_size + AV_INPUT_BUFFER_PADDING_SIZE);
    if (!c->extradata) {
      avcodec_free_context(&c);
      return NULL;
    }
    memcpy(c->extradata, seq_copy, seq_size);
    c->extradata_size = seq_size;
  }
  if (avcodec_open2(c, codec, NULL) < 0) avcodec_free_context(&c);
  return c;
}

EMSCRIPTEN_KEEPALIVE int vc1_open(const uint8_t *extradata, int size, int w, int h) {
  vc1_close();
  width = w;
  height = h;
  is_vc1 = 0;
  for (int i = 0; i + 3 < size; ++i)
    if (extradata[i] == 0 && extradata[i + 1] == 0 && extradata[i + 2] == 1 && extradata[i + 3] == 0x0F) is_vc1 = 1;
  if (size > 0) {
    seq_copy = malloc(size);
    if (!seq_copy) return -2;
    memcpy(seq_copy, extradata, size);
    seq_size = size;
  }
  ctx = open_context();
  if (!ctx) return -3;
  pkt = av_packet_alloc();
  frame = av_frame_alloc();
  i420 = malloc((size_t)w * h * 3 / 2);
  return pkt && frame && i420 ? (is_vc1 ? 0 : 1) : -4;
}

static int copy_picture(const AVFrame *f) {
  if (f->format != AV_PIX_FMT_YUV420P) return -4;
  uint8_t *out = i420;
  const int fw = f->width < width ? f->width : width, fh = f->height < height ? f->height : height;
  memset(i420, 0, (size_t)width * height * 3 / 2);
  for (int k = 0; k < 3; ++k) {
    const int pw = k ? width / 2 : width, ph = k ? height / 2 : height;
    const int cw = k ? fw / 2 : fw, ch = k ? fh / 2 : fh;
    for (int y = 0; y < ch; ++y) memcpy(out + (size_t)y * pw, f->data[k] + (size_t)y * f->linesize[k], cw);
    out += (size_t)pw * ph;
  }
  return 1;
}

EMSCRIPTEN_KEEPALIVE int vc1_decode(const uint8_t *data, int size) {
  if (!ctx) return -1;
  av_packet_unref(pkt);
  if (av_new_packet(pkt, size) < 0) return -2;
  memcpy(pkt->data, data, size);
  if (avcodec_send_packet(ctx, pkt) < 0) return -3;
  int given = 0;
  for (;;) {
    const int err = avcodec_receive_frame(ctx, frame);
    if (err == AVERROR(EAGAIN) || err == AVERROR_EOF) break;
    if (err < 0) return -5;
    const int r = copy_picture(frame);  // the newest stays in i420
    av_frame_unref(frame);
    if (r < 0) return r;
    ++given;
  }
  return given;
}

EMSCRIPTEN_KEEPALIVE int vc1_first(const uint8_t *data, int size) {
  AVCodecContext *c = open_context();
  if (!c) return -3;
  AVPacket *p = av_packet_alloc();
  AVFrame *f = av_frame_alloc();
  int got = 0;
  if (p && f && av_new_packet(p, size) >= 0) {
    memcpy(p->data, data, size);
    if (avcodec_send_packet(c, p) >= 0 && avcodec_send_packet(c, NULL) >= 0) {
      while (avcodec_receive_frame(c, f) >= 0) {
        if (!got) got = copy_picture(f) > 0;  // the first one out: the frame's own picture
        av_frame_unref(f);
      }
    }
  }
  av_frame_free(&f);
  av_packet_free(&p);
  avcodec_free_context(&c);
  return got;
}

EMSCRIPTEN_KEEPALIVE uint8_t *vc1_picture(void) { return i420; }
EMSCRIPTEN_KEEPALIVE void *vc1_malloc(int n) { return malloc(n); }
EMSCRIPTEN_KEEPALIVE void vc1_free(void *p) { free(p); }
EMSCRIPTEN_KEEPALIVE int vc1_version(void) { return LIBAVCODEC_VERSION_INT; }
