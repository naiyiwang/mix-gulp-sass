var gulpLog = require('gulp-log');
var sass = require('gulp-sass');
var postcss = require('gulp-postcss');
var path = require('path');
var gulpMd5 = require('gulp-md5');
var autoprefixer = require('gulp-autoprefixer');
var rimraf = require('rimraf');
var glob = require('glob');
var fs = require('fs');
var minifyCss = require('gulp-minify-css');
var gutil = require('gulp-util');
var upyunUpload = require('upyun_cdn');
var Q = require('q');
var qiniu = require('./lib/qiniu_deploy');
var browserSync = require('browser-sync').create();
var sassGrapher = require('gulp-sass-grapher');
var watch = require('gulp-watch');


module.exports = function(config, gulp) {
    var sassIncludePaths = config.includePaths;
    var sassSrc = config.src;
    var componentsConfig = config.componentsSass;
    var inlineConfig = config.inlineSass;
    var excludeSrc = config.excludeSrc;
    var version = config.version;
    var cdnConfig = config.cdn || {};
    var isProduction;

    if (gutil.env.env) {
        isProduction = gutil.env.env === 'production';
    } else {
        isProduction = process.env.KDT_NODE_RUN_MODE == 'production';
    }

    if (componentsConfig) {
        if (typeof sassSrc === 'string') {
            sassSrc = [sassSrc];
        }
        if (typeof componentsConfig.src === 'string') {
            sassSrc.push('!' + componentsConfig.src);
        } else {
            for (var i in componentsConfig.src) {
                sassSrc.push('!' + componentsConfig.src[i]);
            }
        }
    }
    if (excludeSrc) {
        if (typeof sassSrc === 'string') {
            sassSrc = [sassSrc];
        }
        if (typeof excludeSrc === 'string') {
            sassSrc.push('!' + excludeSrc);
        } else {
            for (var j in excludeSrc) {
                sassSrc.push('!' + excludeSrc[j]);
            }
        }
    }

    gulp.task('mix-gulp-sass', function() {
        console.log('命令说明:');
        console.log('    clean:sass              =====>           清除打包代码');
        console.log('    build:sass              =====>           打包sass');
        console.log('    watch:sass              =====>           监控sass');
        console.log('    hash:css                =====>           刷新版本文件');
        console.log('    cdn:css                 =====>           上传cdn');
        console.log('    cdncss:upyun            =====>           上传upyun');
        console.log('    cdncss:qiniu            =====>           上传七牛');
    });


    gulp.task('clean:sass', function(cb) {
        return rimraf(config.cleanSrc, cb);
    });

    gulp.task('build:sass', ['clean:sass', 'build:componentsCss', 'build:inlineCss'], function() {
        var processors = [imageUrl];

        var dest = config.devDest;
        if (isProduction) {
            dest = config.prodDest;
        }

        var stream = gulp.src(sassSrc)
            .pipe(sass({
                includePaths: sassIncludePaths,
                outputStyle: 'compressed'
            }))
            .pipe(postcss(processors))
            .pipe(autoprefixer({
                browsers: ['ChromeAndroid > 1', 'iOS >= 4', 'ie > 6', 'ff > 4']
            }));

        if (isProduction) {
            stream = stream.pipe(gulpMd5());
        }

        stream.pipe(gulp.dest(dest))
            .pipe(gulpLog('编译完毕 --->'));

        return stream;
    });

    gulp.task('watch:sass', ['watch:componentsCss', 'watch:inlineCss'], function() {
        var processors = [imageUrl];
        var watchBasePath = config.watchBasePath;

        sassGrapher.init(watchBasePath, { loadPaths: watchBasePath });
        browserSync.init({
            port: 3888
        });

        return watch(sassSrc, {
            base: watchBasePath
        })
            .pipe(sassGrapher.ancestors())
            .pipe(sass({
                includePaths: sassIncludePaths
            }).on('error', function(err) {
                console.log(err);
                this.emit('end');
            }))
            .pipe(postcss(processors))
            .pipe(autoprefixer({
                browsers: ['ChromeAndroid > 1', 'iOS >= 4', 'ie > 6', 'ff > 4']
            }))
            .pipe(gulp.dest(config.devDest))
            .pipe(browserSync.stream())
            .pipe(gulpLog('编译完毕 --->'));
    });

    gulp.task('build:componentsCss', function() {
        if (componentsConfig) {
            return processSass(componentsConfig.src, componentsConfig.dest);
        }
        return;
    });

    gulp.task('watch:componentsCss', function() {
        if (componentsConfig) {
            gulp.watch(componentsConfig.src, function(e) {
                return processSass(e.path, componentsConfig.dest);
            });
        }
        return;
    });

    gulp.task('build:inlineCss', function() {
        if (inlineConfig) {
            inlineConfig.forEach(function(config) {
                return processSass(config.src, config.dest);
            });
        }
        return;
    });

    gulp.task('watch:inlineCss', function() {
        if (inlineConfig) {
            inlineConfig.forEach(function(config) {
                gulp.watch(config.src, function(e) {
                    return processSass(e.path, config.dest);
                });
            });
        }
        return;
    });

    gulp.task('hash:css', function(cb) {
        glob(version.src, function(err, files) {
            if (err) {
                throw err;
            }
            printVersionMap(version.dest, files);
            cb();
        });
    });

    gulp.task('cdn:css', ['cdncss:upyun', 'cdncss:qiniu'])

    gulp.task('cdncss:upyun', function() {
        if (cdnConfig.upyun) {
            return upyunUpload({
                src: cdnConfig.src,
                dest: cdnConfig.dest
            }, cdnConfig.upyun);

        }
    });

    gulp.task('cdncss:qiniu', function() {
        if (cdnConfig.qiniu) {
            var deferred = Q.defer();
            gulp.src(cdnConfig.src)
                .pipe(qiniu(cdnConfig.qiniu, {
                    dir: cdnConfig.dest
                }, deferred));

            return deferred.promise;
        }
    });

    function imageUrl(css) {
        var pattern = /image-url\("(.*)"\)(.*)/g;

        if (css.walkDecls && typeof css.walkDecls === 'function') {
            css.walkDecls(walker);
        } else {
            css.eachDecl(walker);
        }

        function walker(decl) {
            if (decl.value.indexOf('image-url') > -1) {
                decl.parent.replaceValues(pattern, function(string) {
                    var arr = string.split(' ');
                    var res = [];
                    var tmp;

                    for (var i = 0, len = arr.length; i < len; i++) {
                        tmp = arr[i];
                        tmp = tmp.replace(pattern, ' url("/v2/image/$1")$2');
                        res.push(tmp);
                    }
                    res = res.join(' ');
                    return res;
                });
            }
        }
    }

    function printVersionMap(versionPath, array) {
        var str = '';
        var maps = [];
        var base = version.base;
        var checkSame = {};

        array.sort();
        array.forEach(function(item) {
            var key;
            var value;

            value = path.relative(base, item);

            key = value;
            key = key.split('_');
            key.pop();
            key = key.join('_');

            if (checkSame[key]) {
                throw new Error('same key => key: ' + key + '; value: ' + checkSame[key]);
            } else {
                checkSame[key] = item;
            }

            maps.push('"' + key + '" => "' + version.per + value + '"');
        });

        str += '<?php return array(\n';
        str += maps.join(',\n');
        str += '\n); ?>';

        fs.writeFileSync(versionPath, str);

        console.log('hash写入 ' + versionPath + ' 成功');
        console.log('共 ' + maps.length + ' 个文件');
    }

    function processSass(srcPath, destPath) {
        var processors = [imageUrlForComponentCss];
        return gulp.src(srcPath)
            // 编译Sass
            .pipe(sass({
                includePaths: sassIncludePaths
            }))
            .pipe(postcss(processors))
            // 自动添加CSS3的前缀
            .pipe(autoprefixer({
                browsers: ['ChromeAndroid > 1', 'iOS >= 4', 'ie > 6', 'ff > 4']
            }))
            .pipe(minifyCss())
            .pipe(gulp.dest(destPath))
            .pipe(gulpLog('编译完毕 --->'));
    }

    function imageUrlForComponentCss(css) {
        var pattern = /image-url\("(.*)"\)(.*)/g;

        if (css.walkDecls && typeof css.walkDecls === 'function') {
            css.walkDecls(walker);
        } else {
            css.eachDecl(walker);
        }

        function walker(decl) {
            if (decl.value.indexOf('image-url') > -1) {
                decl.parent.replaceValues(pattern, function(string) {
                    var arr = string.split(' ');
                    var res = [];
                    var tmp;
                    for (var i = 0, len = arr.length; i < len; i++) {
                        tmp = arr[i];
                        // showcase css inline到html中后，css文件相对域名为wap.koudaitong.com，所以图片路径需要使用绝对路径
                        tmp = tmp.replace(pattern, 'url("' + (cdnConfig.path || 'https://b.yzcdn.cn') + '/v2/image/$1")$2');
                        res.push(tmp);
                    }
                    res = res.join(' ');
                    return res;
                });
            }
        }
    }
}
