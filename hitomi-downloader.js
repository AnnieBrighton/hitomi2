//
//
//

const request = require("request");
const cheerio = require('cheerio');
const archiver = require('archiver');
const mkdirp = require('mkdirp');
const async = require('async');
const rmdir = require('rmdir');
const fs = require('fs');

const workdir = './getImg_';

function output_message( err ) {
  if (err) {
    console.log(err);
  }
}

function getImageList(id, callback) {
  var reader = { url : 'https://hitomi.la/reader/' + id + '.html', retry : 10 };
  var urls = [];
  var title = '';

  var queue = async.queue(function(list, next) {
    request( list.url, function( err, res, body ) {
      var msg = null;
      if (err) {
        // リトライ回数が正の場合、リトライ回数を減らしリクエストを待ち行列に投入
        if ( list.retry > 0 ) {
          queue.unshift( { url : list.url, retry : --list.retry }, output_message );
          msg = 'err[' + err + '] retry:' + list.url;
        } else {
          msg = 'retry over:' + list.url;
        }
      } else if(res.statusCode != 200 && res.statusCode != 304) {
        // リトライ回数が正の場合、リトライ回数を減らしリクエストを待ち行列に投入
        // ただし、ステータスが404 (Not Found)の場合は、リクエストの再投入は行わない。
        if ( list.retry > 0 && res.statusCode != 404 ) {
          queue.unshift( { url : list.url, retry : --list.retry }, output_message );
          msg = 'err[' + res.statusCode + '] retry:' + list.url;
        } else {
          msg = 'retry over:' + list.url;
        }
      } else {
        var $ = cheerio.load(body);

        // タイトル取得
        title = $('html head title').text().replace(/\|.*$/, '').trim();

        $('html body').find('.img-url').each(function(i, f){
          u = $(f).text();
          // c = String.fromCharCode(97 + parseInt(id) % 7);
          var c = String.fromCharCode(97);
          var u = u.replace(/\/\/..?\.hitomi\.la\//, 'https://a' + c + '.hitomi.la/');
          urls.push( { url : u, retry : 10 } );
        });
      }
      next(msg);
    });
  }, 1);

  // 待ち行列をすべて処理後に実行
  queue.drain = function() {
    callback( null, id, title, urls);
  };

  // 待ち行列に追加
  queue.push( reader, output_message);
}

//
//
//
Array.prototype.lastVal = function() { return this[this.length - 1]; };

//
//
//
function Imgcallback(err, id, title, urls) {
  console.log('title=' + title);
  var dir = workdir + id + '/' + title;

  async.series([
    // ワークディレクトリ作成
    function(next) {
      mkdirp(dir, next );
    },
    // イメージダウンロード
    function(next) {
      var queue = async.queue(function(list, q_next) {
        var file = dir + '/' + list.url.split( '/' ).lastVal();
        console.log( 'url=' + list.url );

        request.get( list.url, {encoding: null}, function(err, res, body) {
          var msg = null;
          if (err) {
            // リトライ回数が正の場合、リトライ回数を減らしリクエストを待ち行列に投入
            if ( list.retry > 0 ) {
              queue.unshift( { url : list.url, retry : --list.retry }, output_message );
              msg = 'err[' + err + '] retry:' + list.url;
            } else {
              msg = 'retry over:' + list.url;
            }
          } else if( res.statusCode != 200 && res.statusCode != 304 ) {
            // リトライ回数が正の場合、リトライ回数を減らしリクエストを待ち行列に投入
            // ただし、ステータスが404 (Not Found)の場合は、リクエストの再投入は行わない。
            if ( list.retry > 0 && res.statusCode != 404 ) {
              queue.unshift( { url : list.url, retry : --list.retry }, output_message );
              msg = 'err[' + res.statusCode + '] retry:' + list.url;
            } else {
              msg = 'retry over:' + list.url;
            }
          } else {
            // console.log( 'url=' + list.url + '   file=' + file );
            fs.writeFileSync( file, body );

            if ( res.headers[ 'content-length'] != fs.statSync(file).size ) {
              // リトライ回数が正の場合、リトライ回数を減らしリクエストを待ち行列に投入
              if ( list.retry > 0 ) {
                queue.unshift( { url : list.url, retry : --list.retry }, output_message );
                msg = 'download size err retry:' + list.url;
              } else {
                msg = 'retry over:' + list.url;
              }
            }
          }
          q_next( msg ); // 次の待ち行列を呼び出し
        });
      }, 4);

      // 待ち行列をすべて処理後に実行
      queue.drain = function() {
        next();
      };

      // 待ち行列に追加
      queue.push( urls, output_message);
    },
    // ダウンロードイメージの圧縮
    function(next) {
      const run_archive = function( dir, file, next_p ) {
        var archive = archiver.create( 'zip', {});
        var output = fs.createWriteStream( file );
        archive.pipe(output);
        archive.bulk([
          {
            expand:true,
            cwd:dir,
            src:['**/*'],
            dest:'/',
            dot:true
          }
        ]);
        output.on('close', function() {
          next_p();
        });
        // ZIP圧縮実行
        archive.finalize();
      };

      // アーカイブファイルが存在しているかどうかの確認
      fs.open( title + '.zip', 'ax+', 420 /* =0644 */, function( err, fd) {
        if (err) {
          if (err.code === 'EEXIST') {
            // 存在している場合、ファイル名にidを付与
            run_archive( dir, title + '_' + id + '.zip', next );
          } else {
            next();
          }
        } else {
          // ファイルがオープンできれば、オープンできたファイル名でアーカイブを作成
          fs.close(fd, function(err) {
            run_archive( dir, title + '.zip', next );
          });
        }
      });
    },
    // ワークディレクトリの削除
    function(next) {
      rmdir( workdir + id, function(err, dirs, files) {
        next();
      });
    }
  ]);
}

//
//
//

var argv = process.argv;
const cmd = argv.shift();
const script = argv.shift();

async.eachSeries( argv, function( arg, callback ) {
  getImageList( arg, Imgcallback );
  callback();
});
