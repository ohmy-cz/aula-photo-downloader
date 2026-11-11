FROM emscripten/emsdk:3.1.40@sha256:c1e807a6e03ac5bd5b37bae2ace3c46c08579e2ddeb951037a3b8dac7067f2cc
WORKDIR /src
COPY ffmpeg.tar.gz /tmp/ffmpeg.tar.gz
RUN tar xzf /tmp/ffmpeg.tar.gz --strip-components=1 -C /src
COPY bindings.tar.gz bindings.patch /tmp/
RUN mkdir /bindings && tar xzf /tmp/bindings.tar.gz --strip-components=1 -C /bindings && \
    patch -p1 -d /bindings < /tmp/bindings.patch && \
    cp -r /bindings/src /src/src && cp -r /bindings/build /src/build
ENV FFMPEG_ST=yes INSTALL_DIR=/opt CFLAGS=-O3 CXXFLAGS=-O3 LDFLAGS=-O3
RUN bash build/ffmpeg.sh --disable-everything --disable-network --disable-gpl --disable-nonfree --enable-demuxer=mov,matroska --enable-muxer=mp4,mov,matroska,webm,streamhash --enable-protocol=file --enable-bsf=aac_adtstoasc,extract_extradata,h264_mp4toannexb,hevc_mp4toannexb --enable-parser=h264,hevc,aac,vp8,vp9,opus --disable-iconv
RUN sed -i '/  -lpostproc /d' build/ffmpeg-wasm.sh && mkdir -p /out && bash build/ffmpeg-wasm.sh -sEXPORT_ES6 -o /out/ffmpeg-core.js
